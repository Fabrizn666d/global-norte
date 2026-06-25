# Restaurar un backup de Global Norte

1. Detener la aplicacion: `pm2 stop global-norte`.
2. Guardar una copia del directorio actual `data/` y de `public/uploads`.
3. Para un backup de base de datos, reemplazar `data/globalnorte.db` por el archivo `.db` descargado.
4. Para uploads o PDFs, descomprimir el ZIP y copiar sus carpetas sobre `public/uploads` y `public/pdfs`.
5. Para un backup completo, restaurar `database/globalnorte.db`, `uploads/` y `pdfs/` en las rutas anteriores.
6. Ejecutar `npx prisma generate` y `npx prisma db push`.
7. Iniciar la aplicacion: `pm2 restart global-norte`.
8. Verificar home, catalogo, un pedido y sus PDFs antes de habilitar trafico.

No ejecutar `prisma migrate reset` para restaurar un backup.
