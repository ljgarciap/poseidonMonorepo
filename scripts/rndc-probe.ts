// Sondeo de SOLO LECTURA contra el RNDC de PRUEBAS (tipo 3 = consulta). No puede registrar ni anular nada:
// el ambiente está fijo en 'pruebas' y el cliente solo se usa vía consultar().
// Uso: npx tsx --env-file=.env scripts/rndc-probe.ts <procesoid> <CAMPO1,CAMPO2> [CLAVE=valor ...]
// Ej.: npx tsx --env-file=.env scripts/rndc-probe.ts 4 INGRESOID,NUMMANIFIESTOCARGA NUMMANIFIESTOCARGA=TRUCKE1438
import { createRndcClient, RndcRechazoError } from '../packages/rndc-client/src/index.js';

const [procesoArg, camposArg, ...filtros] = process.argv.slice(2);
const { RNDC_PRUEBAS_USER: username, RNDC_PRUEBAS_PASS: password, RNDC_NIT: nit } = process.env;
if (!username || !password || !nit || !procesoArg || !camposArg) {
  console.error('Faltan RNDC_PRUEBAS_USER/PASS/RNDC_NIT en .env o argumentos <procesoid> <campos>');
  process.exit(1);
}

const documento: Record<string, string> = { NUMNITEMPRESATRANSPORTE: nit };
for (const f of filtros) {
  const i = f.indexOf('=');
  if (i > 0) documento[f.slice(0, i)] = f.slice(i + 1);
}

const client = createRndcClient({
  ambiente: 'pruebas',
  credentials: { username, password },
  onTransaccion: (t) => console.error('[tx]', JSON.stringify({ ...t, responseXml: t.responseXml?.slice(0, 1500) }, null, 1)),
});

try {
  const docs = await client.consultar({ procesoid: Number(procesoArg), campos: camposArg.split(','), documento });
  console.log(`${docs.length} documento(s)`);
  console.log(JSON.stringify(docs.slice(0, 5), null, 2));
} catch (e) {
  if (e instanceof RndcRechazoError) console.log('RECHAZO:', e.mensajes);
  else console.log('FALLO:', (e as Error).name, (e as Error).message);
  process.exitCode = 2;
}
