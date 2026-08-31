# BYTE-IDENTICAL between cadran-seo and transvase. Check with
# `sha256sum Dockerfile` in both repos.
#
# The site is baked into the image rather than bind-mounted from the host:
# Dokploy re-clones its code directory on every deploy, which leaves any bind
# mount pointing at a deleted inode and serves an empty document root.
FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf

# Four files copied BY NAME, never `COPY . .`: Dokploy materialises the app's
# environment as a .env file inside this build context, so a wildcard copy
# would bake STRIPE_SECRET_KEY and RESEND_API_KEY into a permanent image layer
# that `docker history` hands to anyone who can read the image. .dockerignore
# is the second line of that defence, not the first.
COPY index.html    /usr/share/nginx/html/index.html
COPY en/index.html /usr/share/nginx/html/en/index.html
COPY checkout.js   /usr/share/nginx/html/checkout.js

# 127.0.0.1, not localhost: localhost resolves to ::1 first and nginx listens
# on IPv4 only, so the check would fail and Traefik would stop routing to a
# container that is in fact serving. (This comment used to sit between the
# HEALTHCHECK continuation and its CMD, where BuildKit stripped it; the
# reasoning is worth keeping, the placement was not.)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q --spider http://127.0.0.1/ || exit 1
