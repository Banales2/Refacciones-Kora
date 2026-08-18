// Azure Functions corre en UTC. Entre ~18:00 y 23:59 hora de México, en UTC ya
// es "mañana" — usar new Date().toISOString() ahí adelanta un día cualquier
// fecha calendario que se registre por la tarde. Esta función ancla "hoy" a la
// fecha de México sin importar la zona horaria del server.
//
// Vive aquí y no dentro de un service porque la usan varios: el tablero, para
// no adelantar el snapshot diario, y la bitácora de instalaciones, para no
// fechar mañana una pieza montada hoy en la tarde.
export const MX_TZ = 'America/Mexico_City'

export function fechaMexico(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: MX_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}
