import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'

const IMAGES = [
  { src: '/gallery-2.jpg', alt: 'Fuel dispensers under the canopy' },
  { src: '/gallery-6.jpg', alt: 'Staff assisting a customer at the pump' },
  // { src: '/gallery-7.jpg', alt: 'IndianOil signage' },
  { src: '/gallery-8.jpg', alt: 'IndianOil illuminated signage at night' },
]

export default function Gallery({ station }) {
  const [active, setActive] = useState(null)

  return (
    <section id="gallery" className="relative bg-brand-50 px-6 py-16 sm:py-20">
      <div className="mx-auto max-w-5xl">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.5 }}
          className="mb-8 text-center"
        >
          <h2 className="font-heading bg-gradient-to-r from-slate-900 via-slate-700 to-brand-600 bg-clip-text text-xl font-extrabold text-transparent sm:text-2xl">Gallery</h2>
          <p className="mt-2 text-sm text-slate-600 sm:text-base">A look around {station.name}.</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.6 }}
          className="grid grid-cols-1 gap-4 sm:grid-cols-3"
        >
          {IMAGES.map((img) => (
            <button
              key={img.src}
              onClick={() => setActive(img)}
              className="group relative overflow-hidden rounded-xl border border-slate-200 shadow-card transition-shadow hover:shadow-card-hover"
            >
              <img
                src={img.src}
                alt={img.alt}
                className="aspect-[4/3] h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
              />
              <div className="absolute inset-0 bg-slate-950/0 transition-colors group-hover:bg-slate-950/10" />
            </button>
          ))}
        </motion.div>
      </div>

      <AnimatePresence>
        {active && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setActive(null)}
          >
            <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="relative z-10 max-h-[85vh] max-w-3xl"
              onClick={(e) => e.stopPropagation()}
            >
              <img src={active.src} alt={active.alt} className="max-h-[85vh] w-full rounded-lg object-contain" />
              <button
                onClick={() => setActive(null)}
                className="absolute -top-3 -right-3 flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-700 shadow-lg hover:bg-slate-50"
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
