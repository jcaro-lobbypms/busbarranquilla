import axios from 'axios';
import * as cheerio from 'cheerio';
import pool from '../config/database';

const BLOG_URL = 'https://lasrutasdebarranquilla.wordpress.com/';
const UA = 'Mozilla/5.0 (compatible; MiBusBot/1.0; +https://mibus.co)';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export interface ScanResult {
  new: number;
  updated: number;
  unchanged: number;
  skipped: number;
  errors: number;
}

export interface ScanOptions {
  skipManuallyEdited?: boolean;
}

export interface ScanProgress {
  total: number;
  current: number;
  currentRoute: string;
  status: 'scanning' | 'done';
  result?: ScanResult;
}

// ── Extrae URLs de rutas del sidebar del blog ─────────────────────────────────

async function fetchRouteUrls(): Promise<string[]> {
  const { data: html } = await axios.get<string>(BLOG_URL, {
    headers: { 'User-Agent': UA },
    timeout: 15000,
  });

  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const urls: string[] = [];

  const collect = (selector: string): void => {
    for (const el of $(selector).toArray()) {
      const href = $(el).attr('href') ?? '';
      if (
        href.includes('lasrutasdebarranquilla.wordpress.com/') &&
        href !== BLOG_URL &&
        !href.includes('?') &&
        !href.includes('#') &&
        !seen.has(href)
      ) {
        seen.add(href);
        urls.push(href);
      }
    }
  };

  collect('nav a, .widget a, #secondary a, .wp-block-navigation a, .sidebar a');

  if (urls.length === 0) {
    for (const el of $('a').toArray()) {
      const href = $(el).attr('href') ?? '';
      if (
        href.includes('lasrutasdebarranquilla.wordpress.com/') &&
        href !== BLOG_URL &&
        !href.includes('?') &&
        !href.includes('#') &&
        !href.includes('/page/') &&
        !href.includes('/category/') &&
        !href.includes('/tag/') &&
        !seen.has(href)
      ) {
        seen.add(href);
        urls.push(href);
      }
    }
  }

  return urls;
}

// ── Procesa un post individual ────────────────────────────────────────────────

async function processRouteUrl(url: string, result: ScanResult, options: ScanOptions = {}): Promise<string> {
  const { data: html } = await axios.get<string>(url, {
    headers: { 'User-Agent': UA },
    timeout: 15000,
  });

  const $ = cheerio.load(html);

  const title = (
    $('h1.entry-title').first().text() ||
    $('.post-title').first().text() ||
    $('h1').first().text()
  ).trim().toUpperCase();

  if (!title) return '';

  let recorrido = '';
  for (const el of $('p, .entry-content p').toArray()) {
    const text = $(el).text().trim();
    if ((text.includes(' – ') || text.includes(' - ')) && text.length > 20) {
      recorrido = text;
      break;
    }
  }

  if (!recorrido) return title;

  const code = (url.replace(/\/$/, '').split('/').pop() ?? '').toLowerCase();
  if (!code) return title;

  const company = title.split(/\s+/)[0];

  const existing = await pool.query<{ id: number; description: string | null; manually_edited_at: string | null }>(
    'SELECT id, description, manually_edited_at FROM routes WHERE code = $1',
    [code]
  );

  if (existing.rows.length === 0) {
    await pool.query(
      `INSERT INTO routes (name, code, company, description, is_active, status)
       VALUES ($1, $2, $3, $4, false, 'pending')`,
      [title, code, company, recorrido]
    );
    console.log(`🆕 Nueva: ${code}`);
    result.new++;
  } else if (options.skipManuallyEdited && existing.rows[0].manually_edited_at !== null) {
    console.log(`🔒 Omitida (editada manualmente): ${code}`);
    result.skipped++;
  } else if (existing.rows[0].description !== recorrido) {
    await pool.query(
      `UPDATE routes SET name=$1, company=$2, description=$3, status='pending' WHERE id=$4`,
      [title, company, recorrido, existing.rows[0].id]
    );
    console.log(`✏️  Actualizada: ${code}`);
    result.updated++;
  } else {
    console.log(`⏭  Sin cambios: ${code}`);
    result.unchanged++;
  }

  return title;
}

// ── Función principal exportada ───────────────────────────────────────────────

export async function scanBlog(
  onProgress?: (update: ScanProgress) => void,
  options: ScanOptions = {}
): Promise<ScanResult> {
  const result: ScanResult = { new: 0, updated: 0, unchanged: 0, skipped: 0, errors: 0 };

  let urls: string[];
  try {
    urls = await fetchRouteUrls();
  } catch (err) {
    console.error('Error fetching blog index:', err);
    return result;
  }

  console.log(`📋 ${urls.length} URLs encontradas`);
  onProgress?.({ total: urls.length, current: 0, currentRoute: 'Iniciando...', status: 'scanning' });

  for (let i = 0; i < urls.length; i++) {
    try {
      await sleep(300);
      const title = await processRouteUrl(urls[i], result, options);
      onProgress?.({
        total: urls.length,
        current: i + 1,
        currentRoute: title || urls[i],
        status: 'scanning',
      });
    } catch (err) {
      console.error(`❌ Error: ${urls[i]}`, err);
      result.errors++;
      onProgress?.({
        total: urls.length,
        current: i + 1,
        currentRoute: urls[i],
        status: 'scanning',
      });
    }
  }

  console.log(
    `✅ Scan completado — nuevas: ${result.new}, actualizadas: ${result.updated}, ` +
    `sin cambios: ${result.unchanged}, errores: ${result.errors}`
  );

  onProgress?.({ total: urls.length, current: urls.length, currentRoute: '', status: 'done', result });

  return result;
}
