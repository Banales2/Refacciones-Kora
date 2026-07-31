import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { DefaultAzureCredential } from '@azure/identity'
import { SecretClient } from '@azure/keyvault-secrets'
import * as sql from 'mssql'

// Endpoint temporal de diagnóstico: getRoles convierte cualquier fallo en
// roles vacíos, así que desde fuera no se distingue "no hay identidad
// administrada" de "sin permisos en el vault" o "la BD no responde". Aquí
// probamos cada eslabón por separado y devolvemos el error real.
//
// Borrar en cuanto se resuelva el problema de Key Vault, junto con su regla
// en staticwebapp.config.json.

const REFERENCIA_KEY_VAULT = /^@Microsoft\.KeyVault\(SecretUri=(.+?)\)$/

// Nunca devolvemos el valor del secreto. Los errores de mssql pueden incluir
// la cadena de conexión, así que tapamos la contraseña por si acaso.
function limpiar(texto: string): string {
  return texto.replace(/Password=[^;]*/gi, 'Password=***')
}

function describir(err: unknown): string {
  const e = err as { name?: string; message?: string; code?: string }
  const partes = [e?.name, e?.code, e?.message].filter(Boolean)
  return limpiar(partes.join(' | ') || String(err))
}

// Nunca devolvemos el token: sólo si vino, y con qué error si no.
async function probarEndpointsMsi(): Promise<unknown> {
  const recurso = 'https://vault.azure.net'
  const intentos: Array<{ nombre: string; url?: string; cabeceras: Record<string, string> }> = [
    {
      nombre: '2019-08-01 (IDENTITY_ENDPOINT + X-IDENTITY-HEADER)',
      url: process.env.IDENTITY_ENDPOINT,
      cabeceras: { 'X-IDENTITY-HEADER': process.env.IDENTITY_HEADER ?? '' },
    },
    {
      nombre: '2017-09-01 (MSI_ENDPOINT + Secret)',
      url: process.env.MSI_ENDPOINT,
      cabeceras: { Secret: process.env.MSI_SECRET ?? '' },
    },
  ]

  const resultados: Record<string, unknown> = {}

  for (const intento of intentos) {
    if (!intento.url) {
      resultados[intento.nombre] = 'variable no definida'
      continue
    }
    const version = intento.nombre.startsWith('2019') ? '2019-08-01' : '2017-09-01'
    const url = `${intento.url}?resource=${encodeURIComponent(recurso)}&api-version=${version}`
    try {
      const res = await fetch(url, { headers: intento.cabeceras })
      const texto = await res.text()
      let tieneToken = false
      try {
        tieneToken = !!JSON.parse(texto).access_token
      } catch {
        /* la respuesta no era JSON */
      }
      resultados[intento.nombre] = {
        status: res.status,
        token: tieneToken,
        // Si hubo token no enseñamos el cuerpo; si no, el error es lo útil.
        cuerpo: tieneToken ? '(token recibido, omitido)' : limpiar(texto).slice(0, 400),
      }
    } catch (err) {
      resultados[intento.nombre] = 'ERROR: ' + describir(err)
    }
  }

  return resultados
}

export async function diagKeyVault(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const pasos: Record<string, unknown> = {}

  // Paso 1: ¿el runtime expone siquiera una identidad administrada? Si estas
  // variables no están, DefaultAzureCredential no tiene de dónde sacar el
  // token y no hay permiso que arregle eso.
  pasos.identidad = {
    IDENTITY_ENDPOINT: !!process.env.IDENTITY_ENDPOINT,
    IDENTITY_HEADER: !!process.env.IDENTITY_HEADER,
    MSI_ENDPOINT: !!process.env.MSI_ENDPOINT,
    MSI_SECRET: !!process.env.MSI_SECRET,
    AZURE_CLIENT_ID: !!process.env.AZURE_CLIENT_ID,
  }

  // El SDK falló al leer 'expires_on', señal de que el endpoint devolvió algo
  // que no era un token. Lo llamamos a mano con las dos versiones del
  // protocolo para ver el error que da Azure en crudo.
  pasos.msi = await probarEndpointsMsi()

  const configurada = process.env.SQL_CONNECTION_STRING
  if (!configurada) {
    pasos.variable = 'ausente'
    return { status: 200, jsonBody: pasos }
  }

  const referencia = configurada.match(REFERENCIA_KEY_VAULT)
  pasos.variable = referencia ? 'referencia a Key Vault' : 'cadena literal'

  // Con una cadena literal no hay nada que resolver, pero forzamos igualmente
  // la prueba contra el vault si nos pasan ?uri=... para poder diagnosticar
  // sin cambiar la configuración de la aplicación.
  const uriForzado = request.query.get('uri')
  const secretUri = referencia ? referencia[1] : uriForzado

  if (!secretUri) {
    pasos.nota = 'No hay referencia que resolver. Pasa ?uri=<SecretUri> para probar Key Vault.'
    return { status: 200, jsonBody: pasos }
  }

  let nombre = ''
  let version = ''
  try {
    const uri = new URL(secretUri)
    const partes = uri.pathname.split('/')
    nombre = partes[2]
    version = partes[3] || ''
    pasos.vault = { host: uri.origin, secreto: nombre, version: version || '(la última)' }

    // Paso 2: obtener un token. Aquí es donde falla si no hay identidad.
    const credencial = new DefaultAzureCredential()
    try {
      const token = await credencial.getToken('https://vault.azure.net/.default')
      pasos.token = token ? 'obtenido' : 'sin token (respuesta vacía)'
    } catch (err) {
      pasos.token = 'ERROR: ' + describir(err)
      return { status: 200, jsonBody: pasos }
    }

    // Paso 3: leer el secreto. Falla aquí si el token es válido pero la
    // identidad no tiene permisos sobre el vault.
    let cadena: string
    try {
      const cliente = new SecretClient(uri.origin, credencial)
      const secreto = await cliente.getSecret(nombre, version ? { version } : undefined)
      cadena = secreto.value ?? ''
      pasos.secreto = cadena ? `leído (${cadena.length} caracteres)` : 'leído pero vacío'
    } catch (err) {
      pasos.secreto = 'ERROR: ' + describir(err)
      return { status: 200, jsonBody: pasos }
    }

    // Paso 4: comprobar que la cadena guardada realmente conecta.
    try {
      const pool = new sql.ConnectionPool(cadena)
      await pool.connect()
      const r = await pool.request().query('SELECT COUNT(*) AS n FROM usuarios')
      pasos.sql = `conexión OK, ${r.recordset[0].n} usuarios`
      await pool.close()
    } catch (err) {
      pasos.sql = 'ERROR: ' + describir(err)
    }
  } catch (err) {
    pasos.error = describir(err)
    context.error('diagKeyVault falló:', err)
  }

  return { status: 200, jsonBody: pasos }
}

app.http('diagKeyVault', {
  methods: ['GET'],
  route: 'diag-keyvault',
  authLevel: 'anonymous',
  handler: diagKeyVault,
})
