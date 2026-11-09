<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Meta webhook

The Meta webhook endpoint is:

```text
/webhooks/meta
```

Set these values in `.env.development.local` (do not commit them):

```env
META_VERIFY_TOKEN=choose-a-private-verification-token
META_APP_SECRET=your-meta-app-secret
```

Meta uses `GET /webhooks/meta` to verify the callback. Incoming `POST`
requests must include Meta's `X-Hub-Signature-256` header; requests with an
invalid signature are rejected.

To expose only this endpoint during local development, start the API and the
allow-list proxy in separate terminals:

```bash
npm run start:dev
npm run tunnel:meta
```

Then tunnel the proxy port with an HTTPS tunnel provider such as ngrok:

```bash
ngrok http 4000
```

Use the generated HTTPS URL plus `/webhooks/meta` in Meta's webhook
configuration. The proxy rejects every path other than `/webhooks/meta` and
only forwards `GET` and `POST` requests.

## Deployment

Pushes to `main` go to a GCP VM through GitHub Actions. Nothing is built on the VM and nothing
is deployed that did not pass CI.

```
git push main ─▶ CI (lint, build, unit + e2e tests, openapi check)
                  └─ publish: images tagged with the commit SHA → Artifact Registry
                       └─ Deploy (workflow_run, same SHA, no rebuild)
                            └─ IAP SSH → deploy/remote-deploy.sh
                                 migrate → up -d → poll /api/health → roll back on failure
```

### Production layout

One public origin, served by Caddy (automatic HTTPS). Only Caddy publishes ports.

| Path     | Goes to                                                                 |
| -------- | ----------------------------------------------------------------------- |
| `/`      | the dashboard (nginx, port 8080), from the `fekra-dashboard` repository |
| `/api/*` | the API (port 3000), with the `/api` prefix removed                     |

Redis (and PostgreSQL, unless you use Cloud SQL) run on the same private compose network.
The files are in [deploy/](deploy/): `compose.yml`, `Caddyfile`, `remote-deploy.sh`.

Change the Caddyfile in this repository and let the deploy copy it: the deploy reloads Caddy in
place. Do not edit it by hand on the VM with `sed -i` or an editor that saves by renaming the
file: the container only sees in-place writes, so it would keep serving the old config.

Other sites on the same VM (n8n, ...) stay out of this repository. Each one is a file in
`/opt/fekra/caddy/` on the VM (for example `n8n.caddy`), imported by the Caddyfile. They reach
services that publish a port on the VM through `host.docker.internal`:

```
n8n.example.com {
	reverse_proxy host.docker.internal:5678
}
```

That folder is mounted as a directory, so new and edited files are seen by the container. After a
change, reload Caddy: `sudo docker exec fekra-caddy-1 caddy reload --config /etc/caddy/Caddyfile`.

> **Meta webhook URL changes.** Behind the proxy the webhook is
> `https://<host>/api/webhooks/meta` (it was `https://<host>/webhooks/meta`). Update the
> callback URL in the Meta app settings when you switch.

### One-time setup

**GCP**

1. Create an Artifact Registry Docker repository.
2. Create a service account for deployments with `roles/artifactregistry.writer`,
   `roles/compute.instanceAdmin.v1`, `roles/iap.tunnelResourceAccessor` and
   `roles/iam.serviceAccountUser` (on the VM's service account).
3. Create a Workload Identity pool and an OIDC provider for GitHub. Allow only this
   repository (`attribute.repository == "<owner>/fekra-backend"`) and let it impersonate the
   deployment service account. **No JSON keys are created anywhere.**
4. Allow IAP SSH to the VM: a firewall rule for `35.235.240.0/20` on port 22.
5. Give the VM's service account `roles/artifactregistry.reader`, then on the VM run
   `gcloud auth configure-docker <region>-docker.pkg.dev`.

**VM** (Docker with the compose plugin installed)

```bash
sudo mkdir -p /opt/fekra/deploy && sudo chown -R "$USER" /opt/fekra
printf 'DOMAIN=app.example.com\n' > /opt/fekra/deploy/.env      # no secrets in this file
install -m 600 /dev/null /opt/fekra/.env                          # application secrets, see below
```

**GitHub** (Settings → Secrets and variables → Actions → Variables; no secrets are needed here)

| Variable                       | Example                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------- |
| `GCP_PROJECT_ID`, `GCP_REGION` | `my-project`, `europe-west1`                                                  |
| `GAR_REPOSITORY`               | Artifact Registry repository name                                             |
| `GCP_WIF_PROVIDER`             | `projects/123/locations/global/workloadIdentityPools/github/providers/github` |
| `GCP_SERVICE_ACCOUNT`          | `deployer@my-project.iam.gserviceaccount.com`                                 |
| `VM_NAME`, `VM_ZONE`           | `fekra-vm`, `europe-west1-b`                                                  |

Create an environment named `production` (Settings → Environments); add required reviewers if
you want a manual approval before each deploy.

Make `main` a protected branch (Settings → Branches): require a pull request and the **CI /
test** status check, and block force pushes. Deploy only runs for pushes that passed CI, so the
protection is what keeps untested code out of production.

### `/opt/fekra/.env`

Mode 600, owned by the deploy user, never committed. Start from `.env.example` and set:

```dotenv
NODE_ENV=production
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/fekra   # Cloud SQL, or postgres:5432 on the VM
REDIS_HOST=redis
JWT_SECRET=<openssl rand -hex 32>
JWT_EXPIRES_IN=10m
TOKEN_ENCRYPTION_KEY=<openssl rand -hex 32>               # losing it makes stored tokens unreadable
APP_ORIGIN=https://app.example.com
CORS_ORIGINS=                                             # empty: the dashboard is same-origin
SESSION_COOKIE_PATH=/api/auth                             # the path the browser sees behind Caddy
SESSION_IDLE_MINUTES=30                                   # 0 = never sign out for inactivity
SESSION_MAX_HOURS=12                                      # 0 = no absolute limit (stay signed in until sign-out)
OPENAPI_ENABLED=false
# plus the Meta, Gemini and n8n values from .env.example
```

### First deploy and later deploys

Run the **CI** workflow on `main` once, then the API deploys by itself. After that, the
dashboard repository deploys the same way. Each service's last good image is kept in
`/opt/fekra/RELEASE_<service>`.

### Rollback

A failed deploy rolls itself back: if `GET /api/health` is not OK within 60 seconds, the
previous image is started again and the workflow fails. To go back to an older release by hand:

```bash
ssh into the VM (gcloud compute ssh <vm> --tunnel-through-iap)
bash /opt/fekra/deploy/remote-deploy.sh api <old api image@digest> <old migrate image@digest>
```

Migrations are additive (new columns and tables; nothing is dropped in the same release that
stops using it), so the previous API keeps working with the newer schema.

### Running it locally with Docker

`docker compose up -d --build` at the repository root runs PostgreSQL, Redis, the migration and
the API on `127.0.0.1`. The dashboard's browser tests use `npm run seed:e2e` and
`npm run start:e2e` against a database whose name contains `e2e`.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
