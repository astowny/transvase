# 127.0.0.1, not localhost: localhost resolves to ::1 first and this server
# listens on IPv4, so the check would fail against a container that is in fact
# serving, and the orchestrator would stop routing to it.
#
# Single stage on purpose. The spec sketches a deps stage running
# `bun install --frozen-lockfile --production`, but this service has ZERO
# runtime dependencies (@types/bun and typescript are devDependencies), so that
# stage would produce an empty or absent node_modules and the COPY --from=deps
# would fail the build. Nothing is installed here; nothing needs to be.
#
# The tag is not digest-pinned. Pin it at deploy time with the digest from
#   docker buildx imagetools inspect oven/bun:1.3.14-alpine
# and commit the result: a floating tag is how a rebuild silently changes the
# runtime under a service nobody touched.
FROM oven/bun:1.3.14-alpine AS release
WORKDIR /app

# `node-env-production-in-the-final-stage-and-development-false`. Bun's own
# Docker guide sets NODE_ENV in a stage the release stage does not inherit
# from; with it unset, Bun.serve's `development` defaults to true and an
# unhandled throw returns a page whose embedded block decodes to the exception
# message and the server's source text, to any unauthenticated caller. index.ts
# also passes development:false explicitly, because this env var is exactly
# what goes missing in a compose refactor.
ENV NODE_ENV=production

# `explicit-per-file-copy-never-copy-dot`. Dokploy materialises the app env as
# a .env inside the build context; COPY . . would bake STRIPE_SECRET_KEY and
# RESEND_API_KEY into a permanent image layer.
COPY package.json ./
COPY src ./src

# No oven/bun variant sets USER itself.
USER bun
EXPOSE 3000

# `healthcheck-uses-bun-not-wget`: these layers ship neither wget nor curl, so
# copying the nginx healthcheck across would fail permanently.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["/usr/local/bin/bun","-e","const r=await fetch('http://127.0.0.1:3000/api/healthz');process.exit(r.ok?0:1)"]

# Tests run in the shell, not in the build.
ENTRYPOINT ["bun","run","src/index.ts"]
