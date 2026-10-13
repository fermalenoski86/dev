#!/bin/bash
# FALLA PROVOCADA (P-04, AUDIT #75) — se revierte en el commit siguiente. Gate que excede el plazo.
echo '{"password":"abc\\\"DEF-SECRET","x":1}'
sleep 900 &
for i in $(seq 1 900); do echo "línea $i"; sleep 1; done
