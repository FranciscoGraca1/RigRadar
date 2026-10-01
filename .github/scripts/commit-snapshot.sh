#!/usr/bin/env bash
# Grava data/prices.sqlite e dist/prices.json gerados pela recolha diária.
#
# Corrida com pushes humanos: o job fez checkout de main no início; se alguém fizer push
# entretanto, um push direto é rejeitado (non-fast-forward) e as leituras do dia perdiam-se.
# Aqui o commit do bot é refeito sobre o main mais recente (rebase) e o push é repetido.
# Nunca usa force push. Se um commit humano tiver alterado os mesmos ficheiros de dados,
# o rebase falha de forma explícita: o workflow guarda os ficheiros como artefacto.
#
# Sem fontes autorizadas ativas, a única diferença seria o generatedAt do snapshot; nesse
# caso não cria commit diário (ruído no histórico) e repõe o prices.json versionado.
set -euo pipefail

REMOTE="${REMOTE:-origin}"
BRANCH="${BRANCH:-main}"
ATTEMPTS="${ATTEMPTS:-3}"
FILES=(data/prices.sqlite dist/prices.json)

active_sources=$(node -e "const s=require('./dist/prices.json').sources||[]; console.log(s.filter(x=>x.status!=='não configurada').length)")
if [ "$active_sources" = "0" ] && git diff --quiet -- data/prices.sqlite; then
  echo "Sem fontes ativas e sem leituras novas: não há commit."
  git checkout -- dist/prices.json
  exit 0
fi

git add "${FILES[@]}"
if git diff --cached --quiet; then
  echo "Snapshot sem alterações: não há commit."
  exit 0
fi
git commit -m "Atualizar histórico de preços"

for attempt in $(seq 1 "$ATTEMPTS"); do
  if git push "$REMOTE" "HEAD:$BRANCH"; then
    echo "Histórico publicado (tentativa $attempt)."
    exit 0
  fi
  echo "Push rejeitado (tentativa $attempt): a refazer o commit sobre $REMOTE/$BRANCH."
  git fetch "$REMOTE" "$BRANCH"
  if ! git rebase "$REMOTE/$BRANCH"; then
    git rebase --abort || true
    echo "::error::Um commit em $BRANCH alterou os ficheiros de dados; resolução manual necessária. Os ficheiros desta recolha ficam no artefacto do workflow." >&2
    exit 1
  fi
done
echo "::error::Não foi possível publicar o histórico após $ATTEMPTS tentativas." >&2
exit 1
