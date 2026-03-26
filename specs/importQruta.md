# Spec: importQruta — Importador de rutas desde qruta Parse Server

## Contexto

qruta (`qruta-main.up.railway.app`) tiene 300 rutas con geometría GPS real.
Tras filtrar basura, Transmetro y Mío quedan **153 rutas de buses urbanos válidas**,
de las cuales 147 son únicas y 3 son pares IDA/VUELTA.

MiBus actualmente tiene rutas con geometría generada por OSRM (car routing, incorrecta)
o KMZ del AMBQ de 2018 (obsoleta). Este script reemplaza esa geometría con los trazados
reales de qruta, sin romper las rutas que ya existen en la DB.

---

## Fuente de datos

- **URL base:** `https://qruta-main.up.railway.app/parse/classes/Route`
- **Header auth:** `X-Parse-Application-Id: 7S389pHCOfe0ZRH7Dd3598YOpOr9AaJ63r9VdV49`
- **Campos a pedir:** `name, details, path, company, status` + `include=company`
- **Paginación:** límite 100 por página, iterar hasta agotar resultados

---

## Filtros obligatorios (qruta-side)

Descartar una entrada de qruta si:

| Condición | Razón |
|-----------|-------|
| `name === 'Borrar'` | Datos de prueba/basura |
| `status !== true` | Ruta inactiva |
| `path` vacío o `path.length < 3` | Sin geometría útil |
| Empresa en lista de exclusión (ver abajo) | Fuera de scope |

**Empresas excluidas:**
```
Transmetro, Mio, A. prueba
```
(comparación case-insensitive)

---

## Deduplicación dentro de qruta

La unicidad de una ruta se define siempre como el par **(empresa + código)**, nunca
solo por código — porque el mismo código puede existir en dos empresas distintas y son
rutas legítimamente diferentes.

### Pares IDA / VUELTA

Tres rutas en qruta aparecen dos veces con la **misma empresa y mismo código**:

| Código | Empresa | Entrada 1 (details) | Pts | Entrada 2 (details) | Pts |
|--------|---------|---------------------|-----|---------------------|-----|
| D4 | Cootrasol | Normandía | 449 | Villa Angelita | 419 |
| PT2 | Coolitoral | Circunvalar Universidades Vía 40 | 518 | Circunvalar Universidades Villa Carolina | 360 |
| PT3 | Coolitoral | Soledad 2000 Vía 40 Villa Carolina Universidades | 325 | Via 40 - Universidades - Circunvalar | 494 |

### Regla IDA/VUELTA

Para un par `(code, empresa)` con exactamente 2 entradas:
- Entrada con **más puntos** → código `"CODE"` (ej. `"D4"`)
- Entrada con **menos puntos** → código `"CODE-R"` (ej. `"D4-R"`)

El sufijo `-R` significa "Retorno". En DB quedarán como dos rutas distintas.

Si hay más de 2 entradas para el mismo `(code, empresa)` → error, loguear y saltar.

---

## Cross-reference contra MiBus DB

Los códigos en MiBus tienen sufijo de resolución (`"A1-4106"`), qruta usa solo el código corto (`"A1"`).
Las empresas en qruta usan nombres distintos a MiBus (`"Coolitoral"` vs `"COOLITORAL"`), por eso la
comparación de empresa siempre es **case-insensitive** y normalizada (sin tildes, sin guiones).

### Orden de búsqueda

Para cada entrada qruta `(qrutaCode, qrutaEmpresa)`, buscar en este orden:

1. **Match por empresa + código exacto:**
   ```sql
   SELECT id, code FROM routes
   WHERE LOWER(company) = LOWER($qrutaEmpresa)
     AND code = $qrutaCode
     AND type = 'bus'
   ```

2. **Match por empresa + prefijo de código:**
   ```sql
   SELECT id, code FROM routes
   WHERE LOWER(company) = LOWER($qrutaEmpresa)
     AND code LIKE $qrutaCode || '-%'
     AND type = 'bus'
   ```

3. **Match solo por código exacto (empresa no coincide):**
   ```sql
   SELECT id, code, company FROM routes
   WHERE code = $qrutaCode AND type = 'bus'
   ```
   → Si hay match: loguear advertencia `⚠️ empresa diferente (DB: X / qruta: Y)` y usar ese id igualmente.

4. **Match solo por prefijo (empresa no coincide):**
   ```sql
   SELECT id, code, company FROM routes
   WHERE code LIKE $qrutaCode || '-%' AND type = 'bus'
   ```
   → Mismo comportamiento que caso 3.

5. **Sin match:** la ruta es nueva, se insertará con el código qruta tal cual.

### Regla anti-duplicado

Antes de insertar una ruta nueva, verificar que no exista ya otra ruta en DB con
`LOWER(company) = LOWER($qrutaEmpresa) AND LOWER(code) = LOWER($qrutaCode)`.
Si existe → saltar con aviso `⚠️ DUPLICADO EVITADO`.

El `id` y `code` encontrado en DB es el que se usa para el upsert (no se cambia el código existente).

---

## Política de conflicto de geometría

Cuando una ruta ya existe en DB **y** qruta tiene un trazado diferente, aplicar estas reglas
**en orden** antes de decidir si se reemplaza:

### 1. Validación de bbox (sanidad mínima)

Calcular el centroide del trazado qruta. Si cae fuera del AMB:
```
lat: 10.60 – 11.20
lng: -75.10 – -74.50
```
→ **Rechazar siempre**, no importa nada más. Loguear como `❌ FUERA DE BBOX`.
El trazado en DB queda sin tocar.

### 2. Clasificación por distancia entre centroides

Calcular centroide del trazado actual en DB y del trazado qruta. Medir distancia haversine:

| Δ centroide | Clasificación | Acción |
|-------------|---------------|--------|
| ≤ 800 m | `MEJORA` — mismo corredor, más detalle | Reemplazar siempre |
| 800 m – 3 km | `CAMBIO` — posiblemente variante de ruta | Reemplazar, marcar en reporte con `⚠️` |
| > 3 km | `CONFLICTO` — trazados muy distintos | **NO reemplazar en --apply automático** |

### 3. Regla especial: ruta sin geometría actual

Si la ruta existe en DB pero `geometry IS NULL` o `geometry = '[]'` → reemplazar siempre
(no hay nada que perder, solo hay que pasar la validación de bbox).

### 4. Comportamiento de `CONFLICTO` (Δ > 3 km)

- En `--dry-run`: mostrar en sección separada `🔴 CONFLICTOS` con ambos centroides y la distancia.
- En `--apply`: **saltar** la actualización de geometría, loguear `🔴 CONFLICTO SALTADO`.
  La ruta sigue existiendo en DB con su geometría anterior intacta.
  El admin puede revisar visualmente y corregir con el editor de trazado.
- En `--force`: flag adicional que ignora el umbral y reemplaza todo lo que pase bbox.

```bash
npx ts-node src/scripts/_runImport.ts qruta --apply --force   # reemplaza incluso conflictos
```

### Resumen visual en el reporte

```
✅ MEJORA   (Δ ≤ 800m)    — 65 rutas   → se reemplazan
⚠️  CAMBIO   (800m–3km)   — 10 rutas   → se reemplazan con advertencia
🔴 CONFLICTO (Δ > 3km)    —  3 rutas   → NO se reemplazan (usar editor)
❌ FUERA BBOX              —  0 rutas   → rechazadas
➕ NUEVAS                  — 69 rutas   → se insertan
↔  IDA/VUELTA              —  6 rutas   → 3 pares procesados
⚠️  DUPLICADO EVITADO      —  0 rutas
```

---

## Modos de ejecución

```bash
npx ts-node src/scripts/_runImport.ts qruta                      # interactivo (muestra reporte y pide [y/N])
npx ts-node src/scripts/_runImport.ts qruta --dry-run            # solo reporte, no toca DB
npx ts-node src/scripts/_runImport.ts qruta --apply              # aplica sin confirmar (respeta umbral 3km)
npx ts-node src/scripts/_runImport.ts qruta --apply --force      # aplica todo, ignora umbral 3km
```

### `--dry-run` / validate-only

Imprime por consola, no escribe nada en DB:

```
=== REPORTE QRUTA (dry-run) ===

✅ MATCH (actualiza geometría)    — 78 rutas
  A1   [Coolitoral]     actual: 245 pts / qruta: 412 pts / centroide Δ 120m
  A2   [Coolitoral]     actual: 198 pts / qruta: 387 pts / centroide Δ 85m
  ...

➕ NUEVAS (se insertarán)         — 69 rutas
  A10B [Cootrantico]    qruta: 356 pts
  A15B [Cootrantico]    qruta: 201 pts
  ...

↔  IDA/VUELTA (2 rutas c/u)      — 3 pares → 6 rutas
  D4   / D4-R   [Cootrasol]      449 pts / 419 pts
  PT2  / PT2-R  [Coolitoral]     518 pts / 360 pts
  PT3  / PT3-R  [Coolitoral]     494 pts / 325 pts

⚠️  SALTADAS                      — N entradas
  [lista de filtradas con razón]

Total a importar: 153 rutas
```

### `--apply` / modo interactivo

Igual que dry-run pero al final escribe en DB:

1. Upsert empresa (igual que `importBuses.ts`)
2. Upsert ruta:
   - Si match en DB → `UPDATE routes SET geometry=$1, company=$2, company_id=$3 WHERE id=$4`
   - Si nueva → `INSERT INTO routes (name, code, company, company_id, color, type, is_active, status, geometry)`
     - `name` = `details` de qruta (o `"Ruta CODE"` si details vacío)
     - `color` = `'#1d4ed8'`
     - `type` = `'bus'`
3. `replaceStops(routeId, sampleStops(geometry, 500))` — igual que importBuses
4. `computeLegsForRoute(routeId)` — igual que importBuses

En modo **interactivo** (sin flags): mostrar reporte y pedir `[y/N]` antes de aplicar.

---

## Centroide (para el reporte)

```ts
function centroid(pts: [number, number][]): [number, number] {
  const lat = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const lng = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return [lat, lng];
}
```

Distancia entre centroides: haversine en metros (igual que en importBuses).

---

## Archivos a crear / modificar

| Archivo | Acción |
|---------|--------|
| `backend/src/scripts/importQruta.ts` | Crear — lógica principal |
| `backend/src/scripts/_runImport.ts` | Modificar — agregar caso `qruta` |

### `_runImport.ts` ajuste

```ts
// Agregar import
import { importQruta } from './importQruta';

// Agregar en main()
if (!arg || arg === 'qruta') {
  console.log('\n=== Qruta GPS ===');
  const dryRun = process.argv.includes('--dry-run');
  const apply  = process.argv.includes('--apply');
  const r = await importQruta({ dryRun, apply });
  console.log('QRUTA DONE:', JSON.stringify(r));
}
```

---

## Resultado esperado

```ts
interface ImportQrutaResult {
  matched: number;   // rutas existentes actualizadas
  inserted: number;  // rutas nuevas insertadas
  skipped: number;   // filtradas (Borrar, sin path, excluidas)
  pairs: number;     // pares IDA/VUELTA procesados
  errors: number;
}
```

---

## Verificación final

Después de `--apply`, ejecutar en psql o la consola del backend:

```sql
SELECT count(*) FROM routes WHERE type = 'bus' AND geometry IS NOT NULL;
-- Debe ser > 78 (valor actual)

SELECT code, company, jsonb_array_length(geometry) AS pts
FROM routes
WHERE code IN ('A1', 'D4', 'D4-R', 'PT2', 'PT2-R', 'B4')
ORDER BY code;
-- Verificar que A1, D4, D4-R existen con geometría real
```
