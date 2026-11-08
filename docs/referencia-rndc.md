# Referencia rápida — Guía Web Service RNDC V6 (aprobada 26/10/2026)

Fuente: `GUIA Uso del Web Service en el RNDC V6.pdf` (carpeta raíz). Este resumen no reemplaza las guías de remesa, manifiesto, cumplidos y facturación electrónica del Ministerio, que dan la lista completa de variables por proceso; hay que pedirlas o bajarlas del portal (Consultar Maestros → Diccionario de Datos / Errores).

## Hosts (puerto 8080, HTTP)
| Uso | Host |
|---|---|
| Expedir remesas y manifiestos | `rndcws2.mintransporte.gov.co` |
| Consultas | `plc.mintransporte.gov.co` |
| Demás procesos | `rndcws.mintransporte.gov.co` |
| **Pruebas** | `rndcpruebas.mintransporte.gov.co` (radicados > 900.000.000; BD = foto anual de producción; mismos usuarios) |
| Consultas REST | `plc.mintransporte.gov.co:8081/Rest/rndc` |
| Herramienta manual | `rndc.mintransporte.gov.co/wstest/default{,2,3}.aspx` |

Acceso bloqueado desde IPs extranjeras (producción permite EE. UU.; pruebas solo Colombia). La infraestructura de red la gestiona el tercero.

## Contrato SOAP
- Operación `AtenderMensajeRNDC`, parámetro único `Request` (string XML), respuesta string XML. Estilo rpc/encoded, namespace `urn:BPMServicesIntf-IBPMServices`, soapAction `urn:BPMServicesIntf-IBPMServices#AtenderMensajeRNDC`.
- Encoding XML: `ISO-8859-1`.
- Estructura:
```xml
<root>
  <acceso><username/><password/></acceso>
  <solicitud><tipo/><procesoid/></solicitud>
  <variables>...</variables>
  <documento>...</documento>   <!-- solo consultas -->
</root>
```
- Éxito: `<root><ingresoid>NNN</ingresoid></root>` (radicado). Error: texto del error (diccionario de errores).

## tipo de solicitud
1 registrar · 2 consultar maestros · 3 consultar documentos · 4 policía · 5 generadores de carga · 6 maestros especiales · 7 crear usuario app · 8 consultar conductor · 9 remesas autorizadas GPS

## procesoid relevantes para el MVP
| id | Proceso |
|---|---|
| 3 | Expedir remesa terrestre de carga |
| 4 | Expedir manifiesto de carga |
| 5 | Cumplir remesa |
| 6 | Cumplir manifiesto |
| 9 | Anular remesa |
| 11 | Crear/actualizar tercero |
| 12 | Crear/actualizar vehículo |
| 28 / 29 / 32 | Anular cumplido remesa / cumplido manifiesto / manifiesto |
| 38 | Corregir remesa |
| 73 | Aceptación electrónica del manifiesto (consulta de firma: `fechaing`) |
| 86 / 96 | Factura electrónica de transporte / anular (fase posterior) |

## Variables clave (ejemplos de la guía)
- **Tercero (11):** `NUMNITEMPRESATRANSPORTE, CODTIPOIDTERCERO, NUMIDTERCERO, NOMIDTERCERO, PRIMERAPELLIDOIDTERCERO, NUMTELEFONOCONTACTO, NOMENCLATURADIRECCION, CODMUNICIPIORNDC, CODSEDETERCERO, NOMSEDETERCERO, LATITUD, LONGITUD`
- **Vehículo (12):** `NUMPLACA, CODCONFIGURACIONUNIDADCARGA, PESOVEHICULOVACIO, CODTIPOCARROCERIA, CODTIPOIDTENEDOR, NUMIDTENEDOR` (+ propietario, SOAT, etc. según guía completa)
- **Remesa (3):** `CONSECUTIVOREMESA, CODOPERACIONTRANSPORTE (G), CODNATURALEZACARGA, CANTIDADCARGADA, UNIDADMEDIDACAPACIDAD, CODTIPOEMPAQUE, MERCANCIAREMESA, DESCRIPCIONCORTAPRODUCTO, remitente/destinatario/propietario (tipo id, num id, cod sede), HORAS/MINUTOSPACTOCARGA y DESCARGUE, FECHA/HORACITAPACTADA CARGUE y DESCARGUE`
- **Manifiesto (4):** `NUMMANIFIESTOCARGA, FECHAEXPEDICIONMANIFIESTO, CODMUNICIPIOORIGEN/DESTINOMANIFIESTO, titular, NUMPLACA, NUMPLACAREMOLQUE, conductor(es), VALORFLETEPACTADOVIAJE, RETENCIONICAMANIFIESTOCARGA, VALORANTICIPOMANIFIESTO, CODMUNICIPIOPAGOSALDO, FECHAPAGOSALDOMANIFIESTO, CODRESPONSABLEPAGOCARGUE/DESCARGUE, ACEPTACIONELECTRONICA, OBSERVACIONES, <REMESASMAN procesoid="43"><REMESA><CONSECUTIVOREMESA/>...`
- Fechas de envío `dd/mm/yyyy`; municipios con código RNDC de 8 dígitos (ej. Bogotá `11001000`).

## Reglas operativas
- Terceros y vehículos se registran una vez y solo si cambian; reenviar datos idénticos genera error.
- El RNDC puede responder con consecutivos distintos entre pruebas y producción.
- Consultas: `<variables>` lista de campos, `<documento>` filtros (`NUMNITEMPRESATRANSPORTE` obligatorio), `<documentorango>` para rangos de `FECHAING`.

## Datos reales de referencia (manifiesto TRUCKE1438)
Empresa Truck Express S.A.S. (NIT 9018605600) · autorización 125005068 · general · Cota → Medellín · vía 11872 · placa PWY561 · remesas TRUCKE1587 (1.400 kg papa) y TRUCKE1586 (3.000 kg hortalizas) · remitentes Albiverde y Viva Fresh · destinatario Jerónimo Martins · cargue y descargue pagados por el remitente.
