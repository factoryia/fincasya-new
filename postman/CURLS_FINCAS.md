# Curls para API de Fincas

Base URL: `http://localhost:3001/api`

Variables de entorno necesarias para S3 (en `.env` o `.env.local`):

```
AWS_REGION=us-east-1
AWS_S3_BUCKET_NAME=fincasya
AWS_ACCESS_KEY_ID=tu_access_key
AWS_SECRET_ACCESS_KEY=tu_secret_key
```

---

## Configuración Convex (enlace de producto en Meta)

Para que el "Enlace de producto" no salga Incompleto en Meta, configura la URL base de tu frontend:

```bash
npx convex env set CATALOG_PRODUCT_BASE_URL https://fincasya.cloud
```

El enlace se arma como `{CATALOG_PRODUCT_BASE_URL}/fincas/{id}`. Asegúrate de que tu frontend tenga esa ruta (ej. `/fincas/:id`).

---

## 0. Listar catálogos WhatsApp (obtener IDs para catalogIds)

Antes de crear una finca, obtén los IDs de los catálogos para referenciarlos en `catalogIds`:

```bash
curl -X GET "http://localhost:3001/api/catalogs"
```

Respuesta: array con `_id`, `name`, `whatsappCatalogId`, etc. Usa `_id` en `catalogIds` al crear la finca.

---

## 1. Crear finca (con imágenes, video, temporadas, catálogos)

Sube imágenes y video a S3. Crea la finca en Convex. Si pasas `catalogIds`, crea el producto en Meta y guarda el retailer_id.

**Campos opcionales:** `features`, `pricing`, `catalogIds`, `images`, `video`, `priceBaja`, `priceMedia`, `priceAlta`, `priceEspeciales`, `code`, `category`, `type`. Si no envías `priceBaja`, `priceMedia` ni `priceAlta`, se usa `priceBase` para todos.

```bash
curl -X POST "http://localhost:3001/api/fincas" \
  -F "title=Villa Green 12 pax" \
  -F "description=Hermosa villa campestre ideal para 12 personas ubicada a 2 horas de Bogotá en Villavicencio" \
  -F "location=Villavicencio" \
  -F "capacity=12" \
  -F "lat=4.142" \
  -F "lng=-73.626" \
  -F "priceBase=1200000" \
  -F "priceBaja=1200000" \
  -F "priceMedia=1200000" \
  -F "priceAlta=1200000" \
  -F "code=villa-green-12-pax-vc115" \
  -F "category=ESTANDAR" \
  -F "type=FINCA" \
  -F 'features=["Piscina","BBQ","Cancha"]' \
  -F "images=@/ruta/imagen1.jpg" \
  -F "images=@/ruta/imagen2.jpg" \
  -F "video=@/ruta/video.mp4" \
  -F 'pricing=[{"nombre":"Temporada Baja","fechaDesde":"2025-01-01","fechaHasta":"2025-06-30","valorUnico":1200000,"activa":true},{"nombre":"Temporada Alta","fechaDesde":"2025-07-01","fechaHasta":"2025-12-31","valorUnico":1500000,"activa":true}]' \
  -F 'catalogIds=["m977kbc084b6rgbrxcnzakvw0581mmvv"]'
```

**Variantes:**
- **Varias imágenes:** repite `-F "images=@archivo1.jpg" -F "images=@archivo2.jpg"`
- **features:** JSON array `-F 'features=["Piscina","BBQ"]'` o varias `-F "features=Piscina" -F "features=BBQ"`
- **pricing:** opcional. JSON array `-F 'pricing=[{...}]'`
- **catalogIds:** opcional. JSON array con `_id` de catálogos o ID de Meta. Primero llama `GET /api/catalogs`.
- **code:** debe ser único. No se pueden crear dos fincas con el mismo código.

---

## 2. Crear finca mínima (solo priceBase, sin temporadas ni catálogos)

```bash
curl -X POST "http://localhost:3001/api/fincas" \
  -F "title=CASA LOS OCOBOS" \
  -F "description=Hermosa finca privada en Melgar" \
  -F "location=Melgar" \
  -F "capacity=12" \
  -F "lat=4.142" \
  -F "lng=-73.626" \
  -F "priceBase=1500000" \
  -F "category=ESTANDAR" \
  -F "type=FINCA" \
  -F 'features=["Piscina","Jacuzzi"]' \
  -F "images=@/ruta/imagen.jpg"
```

Si solo envías `priceBase`, se usará para baja, media y alta. No hace falta enviar `pricing` ni `catalogIds`.

---

## 3. Crear finca (solo JSON, sin archivos)

Si no subes imágenes ni video en el create, puedes enviar todo como JSON (ajustando `Content-Type`):

```bash
curl -X POST "http://localhost:3001/api/fincas" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Villa Green 12 pax",
    "description": "Hermosa villa campestre",
    "location": "Villavicencio",
    "capacity": 12,
    "lat": 4.142,
    "lng": -73.626,
    "priceBase": 1200000,
    "priceBaja": 1200000,
    "priceMedia": 1200000,
    "priceAlta": 1200000,
    "code": "villa-green-12-pax",
    "category": "ESTANDAR",
    "type": "FINCA",
    "features": ["Piscina", "BBQ"],
    "pricing": [
      { "nombre": "Temporada Baja", "fechaDesde": "2025-01-01", "fechaHasta": "2025-06-30", "valorUnico": 1200000, "activa": true },
      { "nombre": "Temporada Alta", "fechaDesde": "2025-07-01", "fechaHasta": "2025-12-31", "valorUnico": 1500000, "activa": true }
    ],
    "catalogIds": ["m977kbc084b6rgbrxcnzakvw0581mmvv"]
  }'
```

**Importante:** Con `Content-Type: application/json` no puedes enviar archivos. Para imágenes/video usa multipart (ejemplo 1).

---

## 4. Añadir temporadas a una finca existente

```bash
curl -X POST "http://localhost:3001/api/fincas/{propertyId}/pricing" \
  -H "Content-Type: application/json" \
  -d '{
    "nombre": "Temporada Media",
    "fechaDesde": "2025-03-01",
    "fechaHasta": "2025-05-31",
    "valorUnico": 1350000,
    "activa": true
  }'
```

---

## 5. Reemplazar todas las temporadas

```bash
curl -X PUT "http://localhost:3001/api/fincas/{propertyId}/pricing" \
  -H "Content-Type: application/json" \
  -d '{
    "pricing": [
      { "nombre": "Baja", "valorUnico": 1200000 },
      { "nombre": "Alta", "valorUnico": 1500000 }
    ]
  }'
```

---

## 6. Subir video a una finca existente

```bash
curl -X POST "http://localhost:3001/api/fincas/{propertyId}/video" \
  -F "video=@/ruta/video.mp4"
```

---

## 7. Añadir imagen a una finca existente

```bash
curl -X POST "http://localhost:3001/api/fincas/{propertyId}/images" \
  -F "image=@/ruta/imagen.jpg"
```

---

## 8. Eliminar imagen (BD y S3)

Borra la imagen de Convex y de S3. Reemplaza `{imageId}` por el ID de la imagen.

```bash
curl -X DELETE "http://localhost:3001/api/fincas/images/{imageId}"
```

Para obtener el `imageId`: consulta la finca con `GET /api/fincas/{id}`. La respuesta incluye `imageItems` con `{ id, url }` para cada imagen. Usa ese `id` en el DELETE.

---

## 9. Eliminar finca

Borra la finca, sus imágenes y video de S3, y de Convex (incluyendo sincronización con Meta si estaba en catálogos).

```bash
curl -X DELETE "http://localhost:3001/api/fincas/{propertyId}"
```

---

## 10. Listar catálogos (alternativa vía Convex CLI)

```bash
npx convex run whatsappCatalogs:list
```
