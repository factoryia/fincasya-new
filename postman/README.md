# Colección de Postman - Fincas Convex API

Esta colección contiene todos los endpoints necesarios para probar la API de Fincas con Convex y Better Auth.

## Configuración Inicial

### 1. Importar la colección

1. Abre Postman
2. Haz clic en "Import"
3. Selecciona el archivo `Fincas_Convex.postman_collection.json`

### 2. Configurar Variables de Entorno

La colección incluye variables que debes configurar:

- `convex_url`: URL de tu deployment de Convex (ej: `https://tu-deployment.convex.cloud`)
- `convex_site_url`: URL del sitio de Convex (ej: `https://tu-deployment.convex.site`)
- `auth_token`: Se configura automáticamente al iniciar sesión

Para configurar las variables:
1. Selecciona la colección en Postman
2. Ve a la pestaña "Variables"
3. Actualiza `convex_url` y `convex_site_url` con tus valores

## Uso

### Autenticación

1. **Registrar Usuario**: Crea un nuevo usuario (el token se guarda automáticamente)
2. **Iniciar Sesión**: Inicia sesión con un usuario existente
3. **Obtener Sesión**: Verifica tu sesión actual
4. **Cerrar Sesión**: Cierra la sesión actual

### Fincas

#### Queries (Lectura)

- **Listar Fincas**: Obtiene todas las fincas con filtros opcionales
  - Filtros disponibles: `location`, `type`, `category`, `minCapacity`, `maxPrice`
  
- **Obtener Finca por ID**: Obtiene una finca específica por su ID
  
- **Obtener Finca por Código**: Obtiene una finca por su código único
  
- **Buscar Fincas**: Busca fincas por texto (título, descripción, ubicación)

#### Mutations (Escritura)

- **Crear Finca**: Crea una nueva finca
  - Requiere autenticación
  - Incluye imágenes y características opcionales

- **Actualizar Finca**: Actualiza una finca existente
  - Requiere autenticación
  - Solo actualiza los campos proporcionados

- **Eliminar Finca**: Elimina una finca
  - Requiere autenticación
  - También elimina imágenes y características relacionadas

- **Agregar Imagen**: Agrega una imagen a una finca
- **Eliminar Imagen**: Elimina una imagen de una finca
- **Agregar Característica**: Agrega una característica a una finca
- **Eliminar Característica**: Elimina una característica de una finca

### Reservas

- **Crear Reserva**: Crea una nueva reserva
  - Las fechas deben estar en milisegundos (timestamp)
  - Ejemplo: `new Date('2025-01-01').getTime()`

- **Listar Reservas**: Lista reservas con filtros opcionales

## Notas Importantes

1. **Autenticación**: Algunos endpoints requieren autenticación. El token se guarda automáticamente al iniciar sesión.

2. **Fechas**: Las fechas en Convex se almacenan como números (milisegundos desde epoch). Usa `Date.now()` o `new Date().getTime()` en JavaScript.

3. **IDs**: Los IDs de Convex tienen el formato `k1234567890abcdef`. Cópialos de las respuestas para usarlos en otras peticiones.

4. **Tipos de Propiedad**:
   - `FINCA`
   - `CASA_CAMPESTRE`
   - `VILLA`
   - `HACIENDA`
   - `QUINTA`
   - `APARTAMENTO`
   - `CASA`

5. **Categorías**:
   - `ECONOMICA`
   - `ESTANDAR`
   - `PREMIUM`
   - `LUJO`
   - `ECOTURISMO`
   - `CON_PISCINA`
   - `CERCA_BOGOTA`
   - `GRUPOS_GRANDES`
   - `VIP`

6. **Estados de Reserva**:
   - `PENDING`
   - `CONFIRMED`
   - `PAID`
   - `CANCELLED`
   - `COMPLETED`

## Ejemplos de Uso

### Crear una finca completa

```json
{
  "path": "fincas:create",
  "args": {
    "title": "Finca La Esperanza",
    "description": "Hermosa finca con piscina y zona de parrilla",
    "location": "Girardot",
    "capacity": 15,
    "lat": 4.3007,
    "lng": -74.8006,
    "priceBase": 500000,
    "priceBaja": 400000,
    "priceMedia": 450000,
    "priceAlta": 550000,
    "priceEspeciales": 700000,
    "code": "FINCA001",
    "category": "ESTANDAR",
    "type": "FINCA",
    "images": [
      "https://example.com/image1.jpg",
      "https://example.com/image2.jpg"
    ],
    "features": [
      "Piscina",
      "Parrilla",
      "WiFi",
      "Parqueadero"
    ]
  }
}
```

### Buscar fincas con filtros

```json
{
  "path": "fincas:list",
  "args": {
    "limit": 20,
    "location": "Girardot",
    "type": "FINCA",
    "minCapacity": 10,
    "maxPrice": 600000
  }
}
```

## Solución de Problemas

### Error 401 (No autorizado)
- Verifica que hayas iniciado sesión
- Verifica que el token de autenticación esté configurado

### Error 404 (No encontrado)
- Verifica que la URL de Convex sea correcta
- Verifica que el deployment esté activo

### Error 400 (Bad Request)
- Verifica que los argumentos sean correctos
- Verifica los tipos de datos (fechas en milisegundos, etc.)
