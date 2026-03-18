# Spec 45 — Release signing para Google Play

## Problema

`flutter_app/android/app/build.gradle.kts` usa el debug keystore para las builds de release:

```kotlin
release {
    signingConfig = signingConfigs.getByName("debug")
}
```

Google Play rechaza cualquier APK o AAB firmado con el debug keystore. Antes de publicar es necesario:
1. Generar un keystore de producción
2. Configurar `build.gradle.kts` para leerlo sin exponer las credenciales en el repositorio

---

## ⚠️ PASO MANUAL — Ejecutar ANTES de que Codex haga cambios

Este comando lo ejecuta el desarrollador una sola vez en su máquina. El archivo `.jks` resultante
**NUNCA** debe subirse al repositorio (ya está en `.gitignore`).

```bash
keytool -genkey -v \
  -keystore flutter_app/android/mibus-release.jks \
  -alias mibus \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

El comando pedirá interactivamente:
- Contraseña del keystore (guárdala — la necesitarás siempre)
- Nombre, organización, país (puede ser cualquier valor)
- Contraseña de la clave `mibus` (puede ser la misma que el keystore)

Guarda ambas contraseñas en un gestor de contraseñas (1Password, Bitwarden, etc.).

---

## Archivos a modificar por Codex

### File 1 — `flutter_app/android/key.properties` (crear)

Crear este archivo con los valores reales del keystore generado en el paso manual.
El archivo ya está en `.gitignore` — nunca se sube al repositorio.

```properties
storePassword=TU_CONTRASEÑA_KEYSTORE
keyPassword=TU_CONTRASEÑA_CLAVE
keyAlias=mibus
storeFile=../mibus-release.jks
```

> `storeFile` es relativo a `android/app/` (donde está `build.gradle.kts`).
> `../mibus-release.jks` apunta a `android/mibus-release.jks`.

**IMPORTANTE:** Codex debe crear este archivo con valores placeholder que el desarrollador
reemplazará con sus contraseñas reales:
```properties
storePassword=CHANGE_ME
keyPassword=CHANGE_ME
keyAlias=mibus
storeFile=../mibus-release.jks
```

---

### File 2 — `flutter_app/android/app/build.gradle.kts` (modificar)

**Old** (inicio del archivo, antes del bloque `plugins`):
```kotlin
plugins {
```

**New** — agregar imports y carga de key.properties al inicio del archivo:
```kotlin
import java.io.FileInputStream
import java.util.Properties

val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(FileInputStream(keystorePropertiesFile))
}

plugins {
```

**Old** (dentro de `android { ... }`, antes de `defaultConfig`):
```kotlin
    defaultConfig {
```

**New** — agregar bloque `signingConfigs` antes de `defaultConfig`:
```kotlin
    signingConfigs {
        create("release") {
            keyAlias = keystoreProperties["keyAlias"] as String
            keyPassword = keystoreProperties["keyPassword"] as String
            storeFile = keystoreProperties["storeFile"]?.let { file(it as String) }
            storePassword = keystoreProperties["storePassword"] as String
        }
    }

    defaultConfig {
```

**Old** (bloque `buildTypes`):
```kotlin
    buildTypes {
        release {
            // TODO: Add your own signing config for the release build.
            // Signing with the debug keys for now, so `flutter run --release` works.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
```

**New:**
```kotlin
    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
        }
    }
```

---

## Verificación

```bash
# 1. Reemplaza las contraseñas placeholder en flutter_app/android/key.properties
#    con las contraseñas reales del keystore generado.

# 2. Compila la APK de release
cd flutter_app
~/development/flutter/bin/flutter build apk --release

# 3. Verifica la firma
keytool -printcert -jarfile build/app/outputs/apk/release/app-release.apk

# El output debe mostrar el alias "mibus" y tu nombre/organización,
# NO "Android Debug" ni "ANDROIDDEBUGKEY".
```

## Comportamiento después de este spec

- `flutter build apk --release` y `flutter build appbundle --release` usan el keystore de producción
- Si `key.properties` no existe (ej: CI/CD sin el archivo), Gradle hace `keystoreProperties` vacío y la build falla con error claro en vez de firmar con debug silenciosamente
- El archivo `mibus-release.jks` y `key.properties` están en `.gitignore` — nunca se suben al repo
- Para CI/CD futuro: pasar las credenciales como variables de entorno e inyectarlas en `key.properties` antes de compilar
