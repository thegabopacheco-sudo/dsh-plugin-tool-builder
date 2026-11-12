# Cómo funciona dsh-plugin-tool-builder

Genera el esqueleto de un plugin MCP para DeepSeek Harness (package.json, cordis, server.mjs, tests, docs) a partir de nombre y descripcion, sin inventar logica.

## Arquitectura

```
DSH ──MCP stdio──► server.mjs (bundle single-file)
                    └─ lógica local del plugin
```

## Herramientas reales

- `status`: Estado
- `ping`: Ping
- `status`: Estado
- `preview`: Previsualizar esqueleto
- `generate`: Generar plugin

## Seguridad

- Lectura por defecto; acciones con `confirm:true`.
- Modo `read-only` por variable de entorno.
- Listas blancas cuando aplique.
- Auditoría en `<DSH_HOME>\cache\tool-builder\audit.jsonl`.
- Rate limit de acciones.

## Verificación

Tests end-to-end con el cliente MCP oficial (`@modelcontextprotocol/client@2.2.0`)
y artefacto empaquetado (`npm pack` → `postinstall` → servidor desplegado).
