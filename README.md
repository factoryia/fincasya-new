# Convex Fincas

Sistema de gestión de fincas con Convex y Better Auth.

## Estructura

```
convexfincas/
├── convex/         # Backend Convex (DB, RAG, auth, webhooks)
├── src/            # API REST NestJS
├── scripts/        # Scripts de utilidad (importar-fincas)
├── postman/        # Colecciones Postman
└── package.json    # Un solo package.json con todo
```

## Configuración Inicial

### 1. Instalar dependencias

```bash
bun install
```

### 2. Variables de entorno

Crea `.env` o `.env.local` en la raíz. Variables: `CONVEX_URL`, `CONVEX_SITE_URL`, `BETTER_AUTH_SECRET`, `SITE_URL`, `OPENAI_API_KEY`, etc.

### 3. Convex (primera vez)

```bash
bunx convex dev
```

Cuando se te pregunte sobre autenticación, elige "none". Si ya está configurado, se conectará automáticamente.

### 4. Configurar variables en Convex

```bash
bunx convex env set BETTER_AUTH_SECRET=$(openssl rand -base64 32)
bunx convex env set SITE_URL=http://localhost:3000
bunx convex env set OPENAI_API_KEY=sk-...
# YCloud: YCLOUD_API_KEY, YCLOUD_WABA_NUMBER
```

### 5. Generar esquema de Better Auth

```bash
bunx @better-auth/cli generate --config ./convex/betterAuth/auth.ts --output ./convex/betterAuth/schema.ts
```

## Uso

### Desarrollo: Convex + NestJS al mismo tiempo

```bash
bun run dev
```

Inicia **Convex** y **API NestJS** en paralelo (Convex en modo dev, API en http://localhost:3001/api).

### Solo Convex

```bash
bun run dev:convex
```

### Solo API NestJS

```bash
bun run dev:api
```

### Desplegar Convex

```bash
bun run deploy
```

## API de Fincas

### Queries

- `fincas.list` - Listar fincas con filtros
- `fincas.getById` - Obtener finca por ID
- `fincas.getByCode` - Obtener finca por código
- `fincas.search` - Buscar fincas por texto

### Mutations

- `fincas.create` - Crear nueva finca
- `fincas.update` - Actualizar finca
- `fincas.remove` - Eliminar finca
- `fincas.addImage` - Agregar imagen
- `fincas.removeImage` - Eliminar imagen
- `fincas.addFeature` - Agregar característica
- `fincas.removeFeature` - Eliminar característica

## Base de conocimiento (RAG)

El proyecto incluye **RAG vectorizado** con `@convex-dev/rag` (como en beemo-ai-agent): embeddings con OpenAI y búsqueda semántica.

### Requisitos

- **OpenAI API Key** en Convex (para embeddings y extracción de texto de PDFs/imágenes):

```bash
npx convex env set OPENAI_API_KEY=sk-...
```

### Funciones de conocimiento

| Función | Tipo | Descripción |
|--------|------|-------------|
| `knowledge.list` | query | Listar documentos indexados (con paginación) |
| `knowledge.search` | action | Búsqueda semántica por texto |
| `knowledge.addFile` | action | Subir archivo (PDF, imágenes, texto); se extrae texto y se vectoriza |
| `knowledge.addText` | action | Añadir texto directo al conocimiento |
| `knowledge.indexFincas` | action | Indexar fincas de la BD en RAG (título, descripción, ubicación, características) |
| `knowledge.deleteFile` | mutation | Eliminar un documento del conocimiento |

### Namespace

Por defecto se usa el namespace `"fincas"`. Puedes pasar `namespace` en las funciones para separar por contexto (por ejemplo por usuario).

### Flujo típico

1. **Indexar fincas**: llamar `knowledge.indexFincas` para que las fincas existentes sean buscables por significado.
2. **Añadir normas/FAQ**: usar `knowledge.addText` con títulos y textos (temporadas, políticas, etc.).
3. **Subir PDFs**: usar `knowledge.addFile` (desde el cliente con el archivo en bytes).
4. **Consultar**: usar `knowledge.search` con una pregunta en lenguaje natural; devuelve fragmentos relevantes.

En Postman hay una carpeta **Conocimiento (RAG)** con ejemplos de list, search, addText, indexFincas y deleteFile.

## Webhook YCloud y conversaciones WhatsApp

Se reciben mensajes entrantes de WhatsApp por **webhook** y se responde automáticamente usando **RAG + fincas**.

### URL del webhook

- **POST** `https://<tu-deployment>.convex.site/webhooks/ycloud`  
  Configura esta URL en el dashboard de YCloud como webhook para mensajes entrantes.
- **GET** misma URL: responde que el endpoint está activo.

### Estados de conversación

| Estado    | Significado |
|----------|-------------|
| **ai**   | La IA responde automáticamente (RAG + fincas). |
| **human**| Solo un agente humano debe responder (la IA no contesta). |
| **resolved** | Conversación cerrada. |

### Lógica

1. **Mensaje entrante (cliente)**  
   Se guarda el mensaje. Si la conversación está en **ai**, se genera respuesta con RAG + fincas y se envía por WhatsApp.

2. **Escalar a humano**  
   Desde el dashboard (o API) se llama `conversations.escalateToHuman`. A partir de ahí la IA no responde; contesta un humano desde YCloud.

3. **Volver a IA**  
   `conversations.setToAiPublic` para que la IA vuelva a responder.

4. **Cerrar**  
   `conversations.resolveConversation` para marcar como resuelta.

5. **Si el humano responde por YCloud**  
   Si YCloud envía evento de mensaje saliente (outbound), la conversación se marca como **human** para que la IA no siga contestando.

### Variables de entorno (Convex)

- `YCLOUD_API_KEY`: API key de YCloud.
- `YCLOUD_WABA_NUMBER`: Número de WhatsApp Business (E164, ej. `573001234567`).

**No hay variables de entorno para catálogos.** Los catálogos y la relación finca–catálogo se configuran en la base de datos desde el frontend.

### Catálogos de WhatsApp (todo en la BD)

- **Tabla `whatsappCatalogs`**: catálogos (nombre, ID de Meta `whatsappCatalogId`, opcional `isDefault`, opcional `locationKeyword` para elegir por ubicación).
- **Tabla `propertyWhatsAppCatalog`**: relación N–N; cada fila es “esta finca está en este catálogo con este `productRetailerId` (identificador de contenido)”.

**APIs:**

- `whatsappCatalogs.list` / `getById` / `getDefault` / `getByLocationKeyword` – consultas.
- `whatsappCatalogs.create` / `update` / `remove` – CRUD de catálogos.
- `propertyWhatsAppCatalog.listByProperty` – catálogos de una finca.
- `propertyWhatsAppCatalog.listByCatalog` – fincas de un catálogo.
- `propertyWhatsAppCatalog.setPropertyInCatalog` – asignar finca a un catálogo con su `productRetailerId`.
- `propertyWhatsAppCatalog.setPropertyCatalogs` – reemplazar todos los catálogos de una finca (lista de `{ catalogId, productRetailerId }`).

Al enviar el catálogo por WhatsApp, el sistema elige el catálogo por `locationKeyword` o por defecto (`isDefault`) y usa los `productRetailerId` de la tabla de relación. Si Meta cambia o borra un catálogo, se actualiza desde el front (editar `whatsappCatalogs` o las relaciones).

### API de conversaciones

- `conversations.list` – Listar conversaciones (opcional filtro por `status`).
- `conversations.escalateToHuman` – Pasar a humano.
- `conversations.setToAiPublic` – Volver a IA.
- `conversations.resolveConversation` – Marcar resuelta.
- `messages.listRecent` – Últimos mensajes de una conversación.

## Autenticación

Better Auth está configurado con:
- Email y contraseña habilitado
- Sesiones en Convex
- Rutas HTTP en `/api/auth/[...all]`


## Documentación

- [Convex Documentation](https://docs.convex.dev)
- [Convex RAG Component](https://docs.convex.dev/components/rag)
- [Better Auth Documentation](https://www.better-auth.com/docs)
- [@convex-dev/better-auth](https://github.com/convex-dev/better-auth)
- [@convex-dev/rag](https://github.com/get-convex/rag)
