#!/usr/bin/env bash
# Salva os dados novos do robô no main. Se o main mudou durante a execução (ex.: publicação feita ao mesmo tempo),
# junta as mudanças (os arquivos do robô prevalecem), refaz a importação e tenta de novo.
set -e
msg="$1"
git config user.name "radar-robo"
git config user.email "radar-robo@users.noreply.github.com"
git add data public/paginas public/fotos
if git diff --cached --quiet; then echo "Sem novidades."; exit 0; fi
git commit -q -m "$msg"
for t in 1 2 3 4; do
  if git push -q origin HEAD:main; then echo "Salvo."; exit 0; fi
  echo "O main mudou durante a execução; juntando e tentando de novo ($t)…"
  git fetch -q origin main
  if ! git rebase -X theirs origin/main; then git rebase --abort; echo "::error::não consegui juntar com o main"; exit 1; fi
  npm run importar > /dev/null
  git add data public/fotos
  git commit -q --amend --no-edit || true
  sleep $((t * 5))
done
exit 1
