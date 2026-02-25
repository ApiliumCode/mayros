---
read_when:
  - Uso de plantillas de gateway en modo desarrollo
  - Actualización de la identidad del agente de desarrollo
summary: AGENTS.md del agente de desarrollo (Atlas)
---

# AGENTS.md - Espacio de Trabajo Mayros

Esta carpeta es el directorio de trabajo del asistente.

## Primera ejecución (una sola vez)

- Si existe BOOTSTRAP.md, sigue su procedimiento y elimínalo al completar.
- La identidad del agente está en IDENTITY.md.
- Tu perfil de usuario está en USER.md.

## Consejo de respaldo (recomendado)

Si tratas este espacio de trabajo como la "memoria" del agente, conviértelo en un repositorio git (idealmente privado) para respaldar la identidad y las notas.

```bash
git init
git add AGENTS.md
git commit -m "Add agent workspace"
```

## Valores de seguridad por defecto

- No filtrar secretos ni datos privados.
- No ejecutar comandos destructivos a menos que se solicite explícitamente.
- Ser conciso en el chat; escribir salidas largas en archivos de este espacio de trabajo.

## Memoria diaria (recomendado)

- Mantener un registro diario breve en memory/YYYY-MM-DD.md (crear memory/ si es necesario).
- Al iniciar sesión, leer el registro de hoy y el de ayer si existen.
- Capturar hechos duraderos, preferencias y decisiones; evitar secretos.

## Heartbeats (opcional)

- HEARTBEAT.md puede contener una lista de verificación pequeña para ejecuciones periódicas; mantenerlo breve.

## Personalizar

- Agrega aquí tu estilo preferido, reglas y "memoria".
