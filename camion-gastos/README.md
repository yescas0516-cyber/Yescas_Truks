# Control del camión

Registra ingresos y gastos (refacciones, combustible, llantas, casetas…) por camión, con totales, utilidad, gastos por categoría y resumen mensual.

**Stack:** Node.js + Express · PostgreSQL · frontend HTML/JS (lo sirve el mismo servidor).

## Probar en tu computadora
1. Instala Node 18+ y PostgreSQL, y crea una base: `createdb camion`
2. `cp .env.example .env` y edita los valores
3. `npm install`
4. `export $(cat .env | xargs) && npm start` → abre http://localhost:3000

Las tablas se crean solas al arrancar.

## Subirlo a internet (Render, ~10 min, plan gratis disponible)
1. Sube esta carpeta a un repositorio de GitHub.
2. En render.com: **New → PostgreSQL** (crea la base) y copia su *Internal Database URL*.
3. **New → Web Service**, conecta tu repo y configura:
   - Build command: `npm install`
   - Start command: `npm start`
4. En *Environment* agrega: `DATABASE_URL` (la del paso 2), `ADMIN_USER`, `ADMIN_PASSWORD`, `JWT_SECRET` (cadena larga aleatoria).
5. Deploy. Render te da una URL con HTTPS. Railway y Fly.io funcionan igual.

## Seguridad
- Usa una `ADMIN_PASSWORD` fuerte y siempre HTTPS (los hosts de arriba ya lo dan).
- Haz respaldos de la base (Render/Railway ofrecen backups).
- Hoy hay un solo usuario. Si necesitas varios (dueño, choferes), se puede agregar una tabla de usuarios.
