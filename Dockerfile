# The site is baked into the image rather than bind-mounted from the host:
# Dokploy re-clones its code directory on every deploy, which leaves any bind
# mount pointing at a deleted inode and serves an empty document root.
FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/index.html

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  # 127.0.0.1, not localhost: localhost resolves to ::1 first and nginx
  # listens on IPv4 only, so the check would fail and Traefik would stop
  # routing to a container that is in fact serving.
  CMD wget -q --spider http://127.0.0.1/ || exit 1
