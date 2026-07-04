// Función serverless de Vercel: proxy hacia sign.mt para obtener el archivo POSE.
//
// El navegador no puede llamar a sign.mt directamente (responde 403 / bloqueo CORS),
// así que esta función reenvía la petición desde el servidor y devuelve el binario
// POSE que consume pose-viewer en el frontend (ver src/utils/poseApi.js).
//
// Ruta pública: /api/pose?text=...&spoken=es&signed=mfs

const UPSTREAM =
  'https://us-central1-sign-mt.cloudfunctions.net/spoken_text_to_signed_pose'

export default async function handler(req, res) {
  const { text, spoken = 'es', signed = 'mfs' } = req.query

  const trimmed = String(text || '').trim()
  if (!trimmed) {
    return res.status(400).json({ error: 'El parámetro "text" es requerido' })
  }

  const params = new URLSearchParams({ text: trimmed, spoken, signed })

  try {
    const upstream = await fetch(`${UPSTREAM}?${params}`)
    if (!upstream.ok) {
      return res
        .status(upstream.status)
        .json({ error: `sign.mt respondió HTTP ${upstream.status}` })
    }

    const buffer = Buffer.from(await upstream.arrayBuffer())

    res.setHeader(
      'Content-Type',
      upstream.headers.get('content-type') || 'application/pose',
    )
    // La animación de una misma frase no cambia: cachéala 1 día.
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400')
    return res.status(200).send(buffer)
  } catch (err) {
    console.error('[api/pose] Error:', err)
    return res.status(502).json({ error: 'No se pudo obtener la animación 3D' })
  }
}
