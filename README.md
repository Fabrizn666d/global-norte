Global Norte es una tienda online B2B para Distribuidora Global Norte E.I.R.L.

## Comandos

```bash
npm run setup
npm run dev
```

Admin inicial:

- Crear o actualizar desde `prisma/seed.ts` usando una contraseña segura antes de producción.
- No publicar credenciales reales en documentación ni repositorio.

La base SQLite queda en `data/globalnorte.db`. El seed carga 409 productos extraidos del PDF de inventario.

## Deploy

```bash
npm run build
pm2 start ecosystem.config.js
```

Usar `nginx.conf.example` como base de proxy inverso.
