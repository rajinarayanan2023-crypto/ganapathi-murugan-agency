import { motion } from 'framer-motion'
import { ShieldCheck, ArrowRight, Wind, Droplet, ShowerHead, ChevronDown } from 'lucide-react'
import { useData } from '../context/DataContext.jsx'
import LandingNav from '../components/landing/LandingNav.jsx'
import TrustBadges from '../components/landing/TrustBadges.jsx'
import AboutSection from '../components/landing/AboutSection.jsx'
import VisitUs from '../components/landing/VisitUs.jsx'
import Gallery from '../components/landing/Gallery.jsx'
import ContactSection from '../components/landing/ContactSection.jsx'

const FACILITIES = [
  { icon: Wind, title: 'Free Air Filling', desc: 'Quick, free tyre air-filling for two-wheelers, cars and trucks.', accent: 'bg-blue-50 text-blue-600' },
  { icon: Droplet, title: 'Engine Oil & Lubricants', desc: 'Genuine 2T, 4T and gear oils stocked for every vehicle.', accent: 'bg-orange-50 text-orange-600' },
  { icon: Droplet, title: 'Coolant Top-Up', desc: 'Radiator coolant refill done right at the pump, on the spot.', accent: 'bg-green-50 text-green-600' },
  { icon: ShowerHead, title: 'Clean Rest Room', desc: 'A clean, well-maintained rest room for customers and travellers.', accent: 'bg-violet-50 text-violet-600' },
]

function scrollTo(href) {
  document.querySelector(href)?.scrollIntoView({ behavior: 'smooth' })
}

export default function Landing() {
  const { station } = useData()

  return (
    <div className="bg-brand-50">
      <LandingNav station={station} />

      {/* Hero */}
      <section id="home" className="relative flex min-h-[85vh] flex-col items-center justify-center overflow-hidden px-6 py-16 text-center">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-brand-200/50 blur-3xl" />
          <div className="absolute -right-24 top-1/3 h-80 w-80 rounded-full bg-ocean-200/40 blur-3xl" />
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#0000000a_1px,transparent_1px),linear-gradient(to_bottom,#0000000a_1px,transparent_1px)] bg-[size:64px_64px]" />
        </div>

        <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-col items-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="mb-5 flex h-16 w-28 items-center justify-center sm:h-20 sm:w-32"
          >
            <img src={station.logo} alt={station.name} className="h-full w-full object-contain" />
          </motion.div>

          <motion.span
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-4 inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3.5 py-1.5 text-xs font-medium text-brand-700"
          >
            <ShieldCheck size={14} /> {station.location} &middot; {station.dealerType}
          </motion.span>

          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="font-heading text-3xl font-extrabold tracking-tight text-slate-900 sm:text-5xl lg:text-6xl"
          >
            Trusted Fuel.<br className="hidden sm:block" />{' '}
            <span className="text-brand-600">Complete Care.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mt-4 max-w-2xl text-base text-slate-600 sm:text-lg"
          >
            Genuine {station.brand} fuel and honest measures, with free air filling, oil, and
            coolant top-ups — all at one stop in {station.location.split(',')[0]}.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="mt-7 flex flex-col items-center gap-3 sm:flex-row"
          >
            <button
              onClick={() => scrollTo('#facilities')}
              className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-brand-700 px-7 py-3.5 text-base font-semibold text-white shadow-lg shadow-brand-600/30 transition-all hover:from-brand-600 hover:to-brand-800 active:scale-[0.98]"
            >
              Explore Facilities
              <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
            </button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="mt-9"
          >
            <TrustBadges />
          </motion.div>
        </div>

        <motion.button
          onClick={() => scrollTo('#facilities')}
          className="absolute bottom-6 z-10 flex flex-col items-center gap-1 text-slate-400 transition-colors hover:text-brand-600"
          animate={{ y: [0, 6, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
          aria-label="Scroll down"
        >
          <span className="text-[11px] font-medium">Scroll</span>
          <ChevronDown size={18} />
        </motion.button>
      </section>

      {/* Facilities */}
      <section id="facilities" className="relative bg-brand-50 px-6 py-16 sm:py-20">
        <div className="mx-auto max-w-5xl">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.5 }}
            className="mb-8 text-center"
          >
            <h2 className="font-heading bg-gradient-to-r from-slate-900 via-slate-700 to-brand-600 bg-clip-text text-xl font-extrabold text-transparent sm:text-2xl">
              Facilities at Our Station
            </h2>
            <p className="mt-2 text-sm text-slate-600 sm:text-base">Everything your vehicle needs, in one stop.</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            {FACILITIES.map((f, i) => (
              <motion.div
                key={i}
                whileHover={{ y: -3 }}
                className="cursor-pointer rounded-xl border border-slate-200 bg-white p-5 text-left shadow-card transition-shadow duration-200 hover:shadow-card-hover"
              >
                <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${f.accent}`}>
                  <f.icon size={18} />
                </div>
                <p className="text-sm font-semibold text-slate-800">{f.title}</p>
                <p className="mt-1 text-xs text-slate-500">{f.desc}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      <AboutSection station={station} />

      {/* Trust badges repeat — lightweight divider before Visit Us */}
      <div className="border-y border-slate-100 bg-brand-50 px-6 py-8">
        <TrustBadges />
      </div>

      <VisitUs station={station} />
      <Gallery station={station} />
      <ContactSection station={station} />
    </div>
  )
}
