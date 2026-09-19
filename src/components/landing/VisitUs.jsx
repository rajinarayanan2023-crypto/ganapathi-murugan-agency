import { motion } from 'framer-motion'
import { MapPin, Phone, Mail, Clock } from 'lucide-react'

// The station's real Google Maps place link — where a click on the embed
// below actually takes you, since the embed itself is just a preview.
const STATION_MAPS_LINK = 'https://maps.app.goo.gl/fNSyW274ipkjYfEx9'

export default function VisitUs({ station }) {
  const fullAddress = [...station.addressLines].join(', ')
  const mapSrc = `https://www.google.com/maps?q=${encodeURIComponent(fullAddress)}&output=embed`

  return (
    <section id="visit" className="relative bg-brand-50 px-6 py-16 sm:py-20">
      <div className="mx-auto max-w-5xl">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.5 }}
          className="mb-8 text-center"
        >
          <h2 className="font-heading bg-gradient-to-r from-slate-900 via-slate-700 to-brand-600 bg-clip-text text-xl font-extrabold text-transparent sm:text-2xl">Visit Us</h2>
          <p className="mt-2 text-sm text-slate-600 sm:text-base">Drop by any day — we're easy to find on NH:208.</p>
        </motion.div>

        <div className="grid grid-cols-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card lg:grid-cols-2">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.5 }}
            className="flex flex-col justify-center gap-4 p-6 sm:p-8"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                <MapPin size={17} />
              </div>
              <p className="pt-1.5 text-sm text-slate-700">{fullAddress}</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <Phone size={17} />
              </div>
              <p className="text-sm text-slate-700">{station.mobiles.join('  /  ')}</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-green-50 text-green-600">
                <Mail size={17} />
              </div>
              <p className="text-sm text-slate-700">{station.email}</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
                <Clock size={17} />
              </div>
              <p className="text-sm text-slate-700">Open Daily &middot; 6:00 AM – 11:00 PM</p>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="relative min-h-[260px] w-full bg-slate-100 lg:min-h-full"
          >
            <iframe
              title="Station location map"
              src={mapSrc}
              className="pointer-events-none h-full min-h-[260px] w-full border-0"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
            {/* The iframe above is just a preview (and would otherwise swallow
                clicks into its own pan/zoom controls) — this transparent
                overlay makes the whole map area a single click-through to the
                station's real Google Maps place page in a new tab. */}
            <a
              href={STATION_MAPS_LINK}
              target="_blank"
              rel="noreferrer"
              aria-label="Open our location in Google Maps"
              className="absolute inset-0"
            />
          </motion.div>
        </div>
      </div>
    </section>
  )
}
