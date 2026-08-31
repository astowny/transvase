# The site is baked into the image rather than bind-mounted from the host:
# Dokploy re-clones its code directory on every deploy, which leaves any bind
# mount pointing at a deleted inode and serves an empty document root.
FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/index.html

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q --spider http://localhost/ || exit 1
