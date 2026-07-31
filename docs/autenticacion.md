# Autenticación y roles

Cómo entra un usuario a la aplicación y de dónde sale su rol. Escrito después
de una tarde entera persiguiendo cuatro fallos que se manifiestan **todos
igual**: el usuario inicia sesión correctamente pero se queda sin rol, y
ningún log dice por qué.

Si estás depurando eso ahora mismo, ve directo a [Síntoma: el usuario entra
pero no tiene rol](#síntoma-el-usuario-entra-pero-no-tiene-rol).

## Cómo funciona

1. El usuario pulsa iniciar sesión y va a `/.auth/login/aad`
   (`src/src/App.tsx`).
2. Static Web Apps lo manda a Entra ID, al tenant configurado en
   `staticwebapp.config.json`.
3. Tras autenticarse, SWA llama **una sola vez** a `/api/getRoles`
   (`api/src/functions/getRoles.ts`), porque el bloque `auth.rolesSource` de
   la config lo declara como fuente de roles.
4. `getRoles` busca el identificador en la tabla `usuarios` y devuelve el rol.
5. SWA guarda ese rol en la cookie de sesión. El backend lo lee en
   `requireRole` (`api/src/shared/auth.ts`) y las rutas `/api/*` lo aplican
   vía `allowedRoles`.

El paso 3 ocurre **sólo durante el login**. Los roles quedan congelados en la
sesión hasta ~8 horas. Cambiar un rol en la base de datos no tiene efecto
hasta que la persona cierra sesión y vuelve a entrar; tampoco sirve para
revocar accesos con rapidez.

## Dar de alta a un usuario

El rol vive en la tabla `usuarios`, y la columna que empareja es
`EntraObjectId` (tipo `uniqueidentifier`, con restricción `UNIQUE`, igual que
`email`).

```sql
INSERT INTO usuarios (nombre, rol, EntraObjectId, email)
VALUES ('Nombre Apellido', 'admin', '<OBJECT_ID_DE_ENTRA>', 'correo@dominio.com');
```

`<OBJECT_ID_DE_ENTRA>` es el **Object ID** que aparece en Entra ID → Users →
el usuario. Con guiones. Roles válidos: `admin`, `editor`, `lector`.

Cuidado, porque aquí se pierde tiempo: el `userId` que aparece en `/.auth/me`
**no siempre es el Object ID de Entra**. Con el proveedor `aad` preconfigurado
de SWA es un identificador propio de la plataforma, distinto. Con la
autenticación personalizada que usamos ahora sí coincide con el `oid`. Para no
depender de eso, `getRoles` prueba el claim `objectidentifier` **y** el
`userId`, así que basta con que uno de los dos esté en la tabla.

## Síntoma: el usuario entra pero no tiene rol

`/.auth/me` devuelve `userRoles: ["anonymous", "authenticated"]` y nada más.
Ojo: `anonymous` no significa que no te reconozca — SWA se lo asigna a todo el
mundo. Que aparezca `authenticated` prueba que el login fue correcto.

Estas son las cuatro causas encontradas, en el orden en que conviene
descartarlas. Ninguna deja rastro en los logs, porque el `catch` de `getRoles`
convierte cualquier error en `roles: []`, indistinguible de "usuario no dado
de alta".

### 1. `SQL_CONNECTION_STRING` es una referencia a Key Vault

**El más difícil de ver.** Si el valor en Azure Portal → Static Web App →
Environment variables tiene esta forma:

```
@Microsoft.KeyVault(SecretUri=https://<vault>.vault.azure.net/secrets/...)
```

...la función recibe ese texto **literal**. SWA sólo expande las referencias a
Key Vault para los secretos de autenticación, no para lo que consume la API.
`mssql` intenta interpretarlo como cadena de conexión, falla, y el rol
desaparece.

**Arreglo:** poner la cadena de conexión literal.

Resolverlo desde el código tampoco funciona, y está comprobado: el runtime de
las funciones gestionadas expone `IDENTITY_ENDPOINT` y `MSI_ENDPOINT` pero
**no** `IDENTITY_HEADER` ni `MSI_SECRET`, así que el endpoint de identidad
responde 401/403 y `DefaultAzureCredential` no consigue token. Da igual que la
identidad de sistema esté activada y tenga Object ID, y da igual el rol que le
asignes en el vault. `api/src/shared/db.ts` conserva la lógica de resolución,
inerte mientras el valor no sea una referencia, por si algún día la API se
mueve a una Function App propia — que es la única forma de recuperar Key Vault
aquí.

### 2. La config no se está desplegando

`staticwebapp.config.json` vive en **`src/src/public/`**. No en la raíz del
repo, y no en `src/public/`.

El motivo: `vite.config.ts` declara `publicDir: 'src/public'`, y esa ruta es
relativa a la raíz del proyecto Vite, que ya es `src/`. El directorio efectivo
es por tanto `src/src/public`. El workflow despliega `output_location: dist`,
así que sólo llega lo que Vite copia ahí.

Si el archivo está en otro sitio, Azure sirve el sitio con su configuración por
defecto: sin `rolesSource` nadie llama a `getRoles`, y sin `allowedRoles` las
rutas no se protegen.

**Cómo comprobarlo sin desplegar:** `npm run build` en `src/` y verificar que
aparece `src/dist/staticwebapp.config.json`.

**Cómo comprobarlo en producción:** `curl -sI https://<sitio>/` debe devolver
los `globalHeaders` propios (`X-Frame-Options: DENY`, y `max-age=31536000` en
`Strict-Transport-Security`). Si ves `max-age=10886400` y ningún
`X-Frame-Options`, esos son los valores por defecto de Azure y tu config no
está desplegada.

### 3. La regla `/api/*` bloquea la llamada a `getRoles`

La función de roles se consulta **durante** el login, cuando el usuario todavía
no tiene ningún rol. Si `/api/*` exige `admin`/`editor`/`lector`, la petición
se rechaza y nunca llega. Por eso existe esta regla, y debe ir **antes** que la
de `/api/*`:

```json
{ "route": "/api/getRoles", "allowedRoles": ["anonymous", "authenticated"] }
```

Detalle que despista al probar: desde fuera, `/api/getRoles` responde **404**
aunque la función exista. Al declararla como `rolesSource`, la plataforma la
reserva para uso interno. No es un error.

### 4. Los roles vienen cacheados de una sesión anterior

Se calculan en el login. Si acabas de desplegar un cambio, tu sesión sigue
teniendo los roles de antes. **Siempre `/logout` y luego `/login`** antes de
concluir que algo no funciona.

## Configuración en Azure que no está en el repo

### Variables de la Static Web App

`ENTRA_CLIENT_ID` y `ENTRA_CLIENT_SECRET`. **No** `AZURE_*`.

Los nombres los referencia `staticwebapp.config.json` mediante
`clientIdSettingName` y `clientSecretSettingName`. Si apuntan a un nombre que
no existe, Azure **descarta el bloque `auth` entero** y devuelve 404 en todo
`/.auth/*`, incluidos `/.auth/me` y `/.auth/logout`, que son endpoints de
plataforma. El login queda inaccesible hasta revertir, y no aparece nada en
ningún log: sólo el 404.

Regla útil: **un 404 en `/.auth/me` significa configuración de autenticación
rechazada**, nunca un problema del proveedor de identidad.

### Registro de la aplicación en Entra

En Entra ID → App registrations → Authentication:

- El redirect URI debe estar bajo la plataforma **Web**, no *Single-page
  application*:
  ```
  https://<sitio>/.auth/login/aad/callback
  ```
  SWA usa flujo híbrido con `response_mode=form_post`, así que Entra responde
  con un **POST**. Los URIs registrados como SPA lo rechazan con
  `AADSTS900561: The endpoint only accepts POST requests`, y el error aparece
  *después* de introducir la contraseña, lo que hace pensar que el problema son
  las credenciales.
- **Implicit grant and hybrid flows → ID tokens** debe estar marcado, porque el
  flujo pide `response_type=code id_token`.
- Si el URI no está registrado, el error es `AADSTS50011`.

### Issuer

`openIdIssuer` apunta al tenant concreto:
`https://login.microsoftonline.com/<TENANT_ID>/v2.0`.

Se evitó `common` porque su documento de descubrimiento publica el issuer como
plantilla (`https://login.microsoftonline.com/{tenantid}/v2.0`), con un
placeholder sin resolver. No llegó a confirmarse si eso rompe SWA: cuando se
probó, los nombres de las variables aún estaban mal, que era el fallo real. Se
deja el tenant literal por ser lo documentado.

Consecuencia a tener en cuenta: con un tenant concreto, sólo entran cuentas que
existan en ese directorio. Una cuenta Microsoft personal necesita estar
invitada como guest.

## Depurar sin logs

El `catch` de `getRoles` devuelve `roles: []` ante cualquier fallo, así que
desde fuera no se distingue nada. Los `context.warn` sí separan "usuario sin
alta" de un fallo de conexión, y se ven en Application Insights si está
habilitado.

Si no lo está, la vía más rápida es un endpoint temporal de diagnóstico que
pruebe cada eslabón por separado —variables de entorno, token de identidad,
lectura del secreto, conexión a SQL— y devuelva el error real en lugar de
tragárselo. Se usó uno así para descartar Key Vault; se borró después. Al
escribirlo, devolver sólo metadatos y enmascarar `Password=[^;]*` en los
mensajes de error.

Probar el flujo de login con `curl` requiere cookie jar (`-c`/`-b`). Sin él
parece un bucle infinito de redirecciones, pero es sólo el nonce que no
persiste.

## Rotar la contraseña de `app_user`

Tres sitios, y el segundo se olvida:

1. `SQL_CONNECTION_STRING` en las variables de la Static Web App.
2. El secreto en Key Vault, si sigue existiendo. Aunque ya no se use, guarda la
   contraseña antigua; si algún día se vuelve a apuntar la variable al vault,
   conectaría con la credencial vieja.
3. `api/local.settings.json` para desarrollo local.

El comando depende del tipo de usuario:

```sql
-- Conectado a refacciones-kora-db
SELECT name, type_desc, authentication_type_desc
FROM sys.database_principals WHERE name = 'app_user';
```

`DATABASE` → usuario contenido, `ALTER USER app_user WITH PASSWORD = '...'`
dentro de la base. `INSTANCE` → `ALTER LOGIN app_user WITH PASSWORD = '...'`
en `master`. Ejecutarlo en el contexto equivocado puede no dar error y dejar la
contraseña sin cambiar.
