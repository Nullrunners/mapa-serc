#!/usr/bin/env bash
# Stawia portal dane.gov.pl (backend 2.62.3 z naszą zmianą) na własnym komputerze, w kontenerach Podmana
# bez uprawnień roota. Robi to samo co docker-compose.local.yml z repozytorium portalu, tylko bez forum
# i bez CMS-a. Jeśli masz Dockera, użyj kroków z portal/README.md.
#
#   portal/portal-lokalnie.sh build     zbuduj obrazy (raz, ok. 20 minut)
#   portal/portal-lokalnie.sh up        uruchom usługi, załóż bazę przy pierwszym starcie, włącz panel, API i Celery
#   portal/portal-lokalnie.sh manage …  polecenie manage.py w kontenerze, np. manage build_aggregated_list aed
#   portal/portal-lokalnie.sh down      zatrzymaj i usuń kontenery (dane zostają w wolumenach)
#
# Po starcie: API http://127.0.0.1:8000, panel https://admin.mcod.local:8443 (admin@mcod.local / testadmin123!),
# strona portalu z portal/mcod-frontend na http://127.0.0.1:4200 (patrz portal/README.md).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
src="${MCOD_BACKEND_DIR:-$here/mcod-backend}"
podman="${PODMAN:-podman}"
net=mcod-backend
subnet=172.18.18
es_heap="${MCOD_ES_HEAP:-512m}"

cd "$src"

prepare() {
  mkdir -p logs media data database test-data
  if [ ! -f .env ]; then
    sed -e 's/^DISCOURSE_FORUM_ENABLED=.*/DISCOURSE_FORUM_ENABLED=false/' \
        -e 's#^MCOD_NGINX_FRONTEND=.*#MCOD_NGINX_FRONTEND=http://host.containers.internal:4200#' env.sample > .env
  fi
  if [ ! -f mcod/settings/local.py ]; then
    # Elasticsearch 6.8 nie przyjmuje ustawienia indeksu "timeout".
    grep -v '"timeout": 1' mcod/settings/local.py.sample > mcod/settings/local.py
  fi
}

build() {
  prepare
  "$podman" build -f docker/postgres/Dockerfile -t postgresql:17-trixie-mcod .
  "$podman" build -f docker/rabbitmq/Dockerfile -t rabbitmq:4.2.5-management-alpine-mcod .
  "$podman" build -f docker/redis/Dockerfile -t redis:8.4.2-trixie-mcod .
  "$podman" build -f docker/elasticsearch/Dockerfile -t elasticsearch:6.8.23-mcod-1 .
  "$podman" build -f docker/rdfdb/Dockerfile -t fuseki:6.0.0-mcod-1 .
  "$podman" build -f docker/nginx/Dockerfile -t nginx:1.29.1-bookworm-perl-mcod-1 .
  "$podman" build --platform linux/amd64 -f docker/app/Dockerfile -t mcod-app:local .
}

running() { [ "$("$podman" inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = "true" ]; }

service() { # service <nazwa> <ostatni oktet adresu> <argumenty podman run…>
  local name="$1" ip="$2"
  shift 2
  if running "$name"; then return; fi
  "$podman" rm -f "$name" >/dev/null 2>&1 || true
  "$podman" run -d --name "$name" --network "$net:ip=$subnet.$ip" "$@" >/dev/null
  echo "uruchomiono $name"
}

app_env=(
  --env-file .env
  -e PYTHONUNBUFFERED=1 -e PYTHONDONTWRITEBYTECODE=1 -e DEBUG=yes -e ENVIRONMENT=local
  -e POSTGRES_HOST=mcod-db -e REDIS_URL=redis://mcod-redis:6379
  -e ELASTICSEARCH_HOSTS=mcod-elasticsearch:9200 -e RABBITMQ_HOST=mcod-rabbitmq:5672
  -e EMAIL_HOST=mcod-smtp -e EMAIL_PORT=1025 -e EMAIL_USE_TLS=0 -e EMAIL_USE_SSL=0
  -e EMAIL_HOST_USER=test@mcod.local -e EMAIL_HOST_PASSWORD=password
  -e FUSEKI_URL=http://mcod-rdfdb:3030 -e DISCOURSE_FORUM_ENABLED=false
)
app_volumes=(
  -v ./data:/usr/src/mcod_backend/data
  -v ./database:/usr/src/mcod_backend/database
  -v ./docker/nginx/certs/mcod.local.pem:/usr/src/mcod_backend/mcod.local.pem
  -v ./manage.py:/usr/src/mcod_backend/manage.py
  -v ./mcod:/usr/src/mcod_backend/mcod
  -v ./media:/usr/src/mcod_backend/media
  -v ./statics:/usr/src/mcod_backend/statics
  -v ./test-data:/usr/src/mcod_backend/test-data
  -v ./translations:/usr/src/mcod_backend/translations
)

manage() {
  "$podman" run --rm --network "$net" "${app_env[@]}" -e COMPONENT=admin "${app_volumes[@]}" \
    mcod-app:local python manage.py "$@"
}

wait_for() { # wait_for <opis> <polecenie…>
  local what="$1" i
  shift
  for i in $(seq 1 90); do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  echo "nie doczekałem się: $what" >&2
  return 1
}

services() {
  prepare
  "$podman" network exists "$net" || "$podman" network create --subnet "$subnet.0/24" "$net" >/dev/null

  service mcod-db 18 --env-file .env -v mcod_postgres_vol_17:/var/lib/postgresql/data postgresql:17-trixie-mcod
  service mcod-rabbitmq 19 --hostname mcod-rabbitmq -v mcod_rabbitmq_vol:/var/lib/rabbitmq rabbitmq:4.2.5-management-alpine-mcod
  service mcod-redis 20 -v mcod_redis_vol:/data redis:8.4.2-trixie-mcod
  service mcod-elasticsearch 21 -e discovery.type=single-node -e node.name=mcod-elasticsearch \
    -e xpack.security.enabled=false -e "ES_JAVA_OPTS=-Xms$es_heap -Xmx$es_heap" \
    -v mcod_elastic_vol:/usr/share/elasticsearch/data -p 127.0.0.1:9200:9200 elasticsearch:6.8.23-mcod-1
  service mcod-smtp 22 --user root docker.io/mailhog/mailhog
  service mcod-rdfdb 23 -e SPARQL_USER=admin -e SPARQL_PASSWORD=Britenet.1 -e DEBUG=yes \
    -v mcod_fuseki_vol_6:/var/lib/fuseki fuseki:6.0.0-mcod-1

  # Mapa serc pod adresem https widocznym z kontenerów portalu: harvester przyjmuje tylko linki https.
  # API Mapy serc musi działać na tym komputerze z PUBLIC_API_URL=https://mapa-serc.mcod.local.
  cat > .mapa-serc-proxy.conf <<CONF
server {
  listen 443 ssl;
  server_name mapa-serc.mcod.local;
  ssl_certificate /certs/mcod.local.crt;
  ssl_certificate_key /certs/mcod.local.key;
  location / {
    proxy_pass ${MAPA_SERC_API:-http://host.containers.internal:8787};
    proxy_set_header Host \$host;
  }
}
CONF
  service mapa-serc-proxy 120,alias=mapa-serc.mcod.local \
    -v ./.mapa-serc-proxy.conf:/etc/nginx/conf.d/default.conf:ro -v ./docker/nginx/certs:/certs:ro \
    docker.io/library/nginx:1.29.1-bookworm-perl

  wait_for "baza danych" "$podman" exec mcod-db pg_isready -U mcod
  wait_for "Elasticsearch" curl -fsS http://127.0.0.1:9200/_cluster/health
}

up() {
  services

  if [ ! -f .portal-db-ready ]; then
    echo "pierwszy start: zakładam bazę i indeksy (kilka minut)"
    manage init_mcod_db
    manage search_index --rebuild -f
    manage compilemessages -v 0 || true
    touch .portal-db-ready
  else
    manage migrate --noinput
  fi

  service mcod-nginx 100,alias=mcod.local,alias=admin.mcod.local,alias=api.mcod.local,alias=cms.mcod.local \
    --env-file .env \
    -v ./docker/nginx/config-templates:/etc/nginx/templates:ro -v ./docker/nginx/certs:/etc/nginx/conf.d/certs:ro \
    -v ./statics:/usr/share/nginx/html/statics -v ./media:/usr/share/nginx/html/media \
    -p 127.0.0.1:8080:80 -p 127.0.0.1:8443:443 nginx:1.29.1-bookworm-perl-mcod-1
  service mcod-admin 101 "${app_env[@]}" -e COMPONENT=admin "${app_volumes[@]}" -p 127.0.0.1:8001:8001 \
    mcod-app:local python manage.py runserver 0:8001
  service mcod-api 102 "${app_env[@]}" -e COMPONENT=api "${app_volumes[@]}" -p 127.0.0.1:8000:8000 \
    mcod-app:local python -m werkzeug.serving --bind 0:8000 mcod.api:app
  service mcod-celery 110 "${app_env[@]}" -e COMPONENT=celery -e CELERY_INSTALL_CERTIFICATES=1 \
    -e CELERY_CONCURRENCY="${MCOD_CELERY_CONCURRENCY:-2}" "${app_volumes[@]}" \
    --entrypoint /usr/local/bin/start-celery-local mcod-app:local

  wait_for "API portalu" curl -fsS http://127.0.0.1:8000/institutions
  echo "portal działa: API http://127.0.0.1:8000, panel https://admin.mcod.local:8443"
}

down() {
  "$podman" rm -f mcod-celery mcod-api mcod-admin mcod-nginx mapa-serc-proxy mcod-rdfdb mcod-smtp mcod-elasticsearch mcod-redis \
    mcod-rabbitmq mcod-db >/dev/null 2>&1 || true
}

case "${1:-}" in
  build) build ;;
  services) services ;;
  up) up ;;
  down) down ;;
  manage) shift; manage "$@" ;;
  *) sed -n '2,12p' "$0"; exit 1 ;;
esac
