# Poker Tournament Manager

PWA para torneos privados de póker. El dinero se guarda en enteros (colones enteros por defecto). La entrada y la recompra tienen precios distintos. Un jugador puede pedir hasta 4 recompras; el anfitrión, hasta 5, y esa recompra extra se cobra igual que las demás. Una solicitud pendiente no crea deuda. Solo un pago confirmado cuenta como cobrado.

## Requisitos

- Node 22 o superior
- pnpm 10

Si `pnpm` no está en el PATH:

```bash
npm install pnpm@10.18.1 --prefix .tools
export PATH="$PWD/.tools/node_modules/.bin:$PATH"
```

## Clonar

```bash
git clone https://github.com/nanrezdj/PKR-torneo.git
cd PKR-torneo
```

## Local

```bash
pnpm install
pnpm db:migrate:local
pnpm db:seed:local
pnpm dev
```

Abre http://127.0.0.1:5173. La API queda en http://127.0.0.1:8787 y Vite la proxifica.

El seed crea cuentas locales, no un torneo con cifras inventadas:

| Correo | Rol |
| --- | --- |
| admin@pkr.local | super admin |
| juan@pkr.local | jugador, sirve de anfitrión |
| carlos@pkr.local, ana@pkr.local, luis@pkr.local, maria@pkr.local, diego@pkr.local | jugadores |

Entra con el correo. El enlace no se envía a internet: aparece en http://127.0.0.1:5173/buzon. Ese buzón solo existe si `ENVIRONMENT=development` (está en `apps/api/.dev.vars`, que se copia del ejemplo al arrancar).

## Comandos

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

## Cloudflare

Hace falta `wrangler login` y una base real. El `database_id` de `apps/api/wrangler.jsonc` es un marcador local.

```bash
pnpm --filter @pkr/api exec wrangler d1 create pkr
```

Copia el id al `database_id`. Para correo real define `RESEND_API_KEY` y `RESEND_FROM`. Sin esas variables el despliegue no envía correo y no debe decir que lo hizo.

```bash
pnpm db:migrate:remote
pnpm build
pnpm deploy
```

No ejecutes el seed remoto: son cuentas de demostración.

## Reloj y audio

El reloj lo manda el servidor. Al reconectar, el cliente pide el snapshot y abre un WebSocket. El aviso sonoro usa Web Audio API solo después de un toque. iOS puede silenciar esa alarma si la app queda en segundo plano; el tiempo oficial no depende del teléfono.

## Qué no está afirmado

El correo con Resend y el despliegue remoto no se han ejecutado en esta máquina si no hay sesión de Cloudflare ni claves.
