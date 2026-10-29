/**
 * Script ejecutable para extraer y sincronizar notas rápidas de Notion
 * Ejemplo de uso:
 *   npm run sync:notion
 *   npx tsx scripts/sync-notion.ts "Sesion jueves 29 oct 26 a las 8:00 pm"
 */
import {
  parseSmartNotionText,
  syncNotionEntriesToCalendarAndSupabase,
} from "../src/lib/services/notion-parser";

async function main() {
  const cliArg = process.argv.slice(2).join(" ").trim();

  if (cliArg) {
    console.log(`\n[moyaspov] Analizando entrada rápida: "${cliArg}"`);
    const preview = parseSmartNotionText(cliArg);
    console.log("[moyaspov] Resultado del parser inteligente:", preview);

    const res = await syncNotionEntriesToCalendarAndSupabase({
      rawLines: [cliArg],
    });
    console.log(
      `[moyaspov] Sincronización completada (${res.parsedCount} evento(s) procesado(s)).`
    );
    return;
  }

  console.log("[moyaspov] Extrayendo bloques desde la página de Notion configurada...");
  const res = await syncNotionEntriesToCalendarAndSupabase({});
  console.log(
    `[moyaspov] Sincronización finalizada: ${res.parsedCount} evento(s) enviados a Google Calendar y Supabase.`
  );
}

main().catch((err) => {
  console.error("[moyaspov] Error en script de sincronización:", err.message);
  process.exit(1);
});
