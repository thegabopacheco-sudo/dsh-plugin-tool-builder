# dsh-plugin-tool-builder — Tool Builder

Genera el esqueleto de un plugin MCP para DeepSeek Harness (package.json, cordis, server.mjs, tests, docs) a partir de nombre y descripcion, sin inventar logica.

## Herramientas

| Tool | Qué hace |
|---|---|
| `status` | Estado |
| `ping` | Ping |
| `status` | Estado |
| `preview` | Previsualizar esqueleto |
| `generate` | Generar plugin |

## Instalación

Desde **DSH → Settings → Plugins** instala `github:thegabopacheco-sudo/dsh-plugin-tool-builder` y permite el script de instalación.

```
dsh plugin --profile <perfil> add github:thegabopacheco-sudo/dsh-plugin-tool-builder
```

## Seguridad

- Lectura por defecto; escritura solo con `confirm:true` y pedido explícito.
- `DSH_TOOL_BUILDER_MODE=read-only` desactiva acciones.
- Listas blancas y auditoría en `<DSH_HOME>\cache\tool-builder\audit.jsonl`.

## Licencia

MIT © thegabopacheco-sudo
