import React from 'react';
import { motion } from 'framer-motion';
import { Shield, Lock, Ghost, Network, AlertTriangle, Check, X, Box, Search, ArrowRight, Zap, Globe, EyeOff, ChevronDown, Radio, Users, Menu } from 'lucide-react';

interface LandingPageProps {
  onConnect: () => void;
  isConnecting: boolean;
}

const fadeInUp = {
  hidden: { opacity: 0, y: 50 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: "easeOut" } }
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.2
    }
  }
};

const LandingPage: React.FC<LandingPageProps> = ({ onConnect, isConnecting }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  const scrollToSection = (id: string) => {
    setMobileMenuOpen(false);
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white overflow-x-hidden font-sans selection:bg-[#FF9900] selection:text-black">
      
      {/* NAVIGATION */}
      <nav className="fixed top-0 left-0 right-0 z-50 px-6 py-4 bg-[#050505]/80 backdrop-blur-md border-b border-[#ffffff]/5">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <Ghost className="text-[#FF9900]" size={24} />
            <span className="font-bold text-xl tracking-wider">GHOST</span>
          </div>
          
          <div className="hidden md:flex items-center gap-8">
            <button onClick={() => scrollToSection('why')} className="text-sm font-medium text-gray-400 hover:text-white transition-colors">WHY GHOST?</button>
            <button onClick={() => scrollToSection('how-it-works')} className="text-sm font-medium text-gray-400 hover:text-white transition-colors">HOW IT WORKS</button>
            <button onClick={() => scrollToSection('features')} className="text-sm font-medium text-gray-400 hover:text-white transition-colors">FEATURES</button>
          </div>

          <button
            onClick={onConnect}
            disabled={isConnecting}
            className="hidden md:flex px-4 py-2 bg-[#FF9900] text-black text-sm font-bold rounded-lg hover:bg-[#ffaa33] transition-colors disabled:opacity-50"
          >
            {isConnecting ? "CONNECTING..." : "CONNECT WALLET"}
          </button>

          {/* Mobile Menu Toggle */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 text-gray-400 hover:text-white transition-colors"
          >
            {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>

        {/* Mobile Menu Dropdown */}
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="md:hidden mt-4 pb-4 border-t border-[#ffffff]/10 pt-4 flex flex-col gap-3"
          >
            <button onClick={() => scrollToSection('why')} className="text-sm font-medium text-gray-400 hover:text-white transition-colors text-left">WHY GHOST?</button>
            <button onClick={() => scrollToSection('how-it-works')} className="text-sm font-medium text-gray-400 hover:text-white transition-colors text-left">HOW IT WORKS</button>
            <button onClick={() => scrollToSection('features')} className="text-sm font-medium text-gray-400 hover:text-white transition-colors text-left">FEATURES</button>
            <button
              onClick={() => { setMobileMenuOpen(false); onConnect(); }}
              disabled={isConnecting}
              className="mt-2 px-4 py-2 bg-[#FF9900] text-black text-sm font-bold rounded-lg hover:bg-[#ffaa33] transition-colors disabled:opacity-50 w-full"
            >
              {isConnecting ? "CONNECTING..." : "CONNECT WALLET"}
            </button>
          </motion.div>
        )}
      </nav>

      {/* SECTION 1: HERO */}
      <section className="relative h-screen flex flex-col items-center justify-center overflow-hidden pt-20">
        {/* Background Network Animation (Abstract) */}
        <div className="absolute inset-0 opacity-20 pointer-events-none">
            <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-[#FF9900]/10 via-transparent to-transparent" />
            <motion.div 
              className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10"
              animate={{ opacity: [0.1, 0.15, 0.1] }}
              transition={{ duration: 2, repeat: Infinity }}
            />
            {/* Grid */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#1a1a1a_1px,transparent_1px),linear-gradient(to_bottom,#1a1a1a_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
        </div>

        <motion.div 
          initial="hidden"
          animate="visible"
          variants={staggerContainer}
          className="z-10 text-center px-4 max-w-5xl mx-auto"
        >
          <motion.div variants={fadeInUp} className="mb-6 flex justify-center">
             <div className="p-4 bg-[#FF9900]/10 rounded-full border border-[#FF9900]/20 animate-pulse">
                <Ghost size={48} className="text-[#FF9900]" />
             </div>
          </motion.div>
          
          <motion.h1 variants={fadeInUp} className="text-6xl md:text-8xl font-black tracking-tighter mb-6 leading-tight">
            GHOST: <br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#FF9900] to-orange-600">
              THE INVISIBLE NETWORK
            </span>
          </motion.h1>
          
          <motion.p variants={fadeInUp} className="text-xl md:text-2xl text-gray-400 mb-10 max-w-2xl mx-auto">
            Connect without metadata. Chat without a trace.
            <br />
            <span className="text-[#FF9900]">Zero-Knowledge Proofs</span> guarantee your privacy.
          </motion.p>
          
          <motion.button
            variants={fadeInUp}
            whileHover={{ scale: 1.05, boxShadow: "0 0 20px rgba(255, 153, 0, 0.5)" }}
            whileTap={{ scale: 0.95 }}
            onClick={onConnect}
            disabled={isConnecting}
            className="px-8 py-4 bg-[#FF9900] text-black text-lg font-bold rounded-xl flex items-center gap-3 mx-auto disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isConnecting ? "CONNECTING..." : "ENTER GHOST"} {!isConnecting && <ArrowRight size={20} />}
          </motion.button>
        </motion.div>

        {/* Floating Mockups (Abstract) */}
        <motion.div 
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 0.5, x: 0 }}
            transition={{ delay: 1, duration: 1.5 }}
            className="absolute -right-20 top-1/4 w-96 h-64 bg-[#111] border border-[#333] rounded-2xl p-4 transform rotate-[-12deg] blur-sm z-0 hidden lg:block"
        >
             <div className="w-full h-full flex flex-col gap-4">
                 <div className="w-3/4 h-8 bg-[#222] rounded-lg animate-pulse" />
                 <div className="self-end w-1/2 h-8 bg-[#FF9900]/20 rounded-lg" />
                 <div className="w-2/3 h-8 bg-[#222] rounded-lg" />
             </div>
        </motion.div>
        <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 2, duration: 1 }}
            className="absolute bottom-8 left-1/2 -translate-x-1/2 text-gray-500 flex flex-col items-center gap-2 cursor-pointer hover:text-white transition-colors"
            onClick={() => scrollToSection('why')}
        >
            <span className="text-xs uppercase tracking-widest">Discover</span>
            <ChevronDown className="animate-bounce" />
        </motion.div>
      </section>

      {/* SECTION 2: THE PROBLEM */}
      <section id="why" className="py-24 bg-[#0A0A0A] relative border-t border-[#1A1A1A]">
        <div className="max-w-7xl mx-auto px-4">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="flex flex-col md:flex-row items-center gap-12"
            >
                <div className="flex-1 space-y-6">
                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-red-500/10 text-red-500 rounded-full border border-red-500/20">
                        <AlertTriangle size={16} />
                        <span className="text-sm font-bold uppercase">Critical Alert</span>
                    </div>
                    <h2 className="text-4xl md:text-5xl font-bold tracking-tight">
                        IS YOUR METADATA <br/>
                        <span className="text-red-500">EXPOSING YOU?</span>
                    </h2>
                    <p className="text-gray-400 text-lg">
                        Standard messengers leak the "who, when, and where". Even if the content is encrypted, your social graph is public property.
                    </p>
                </div>

                <div className="flex-1 relative">
                    <div className="relative p-8 bg-[#111] rounded-3xl border border-red-900/30 overflow-hidden group">
                         <div className="absolute inset-0 bg-red-500/5 group-hover:bg-red-500/10 transition-colors" />
                         
                         {/* Diagram */}
                         <div className="relative z-10 flex items-center justify-between">
                            <div className="flex flex-col items-center">
                                <div className="w-16 h-16 bg-[#222] rounded-full flex items-center justify-center border border-[#333]">
                                    <UserIcon />
                                </div>
                                <span className="mt-2 text-sm text-gray-500">You</span>
                            </div>
                            
                            <div className="flex-1 h-[2px] bg-red-500/50 mx-4 relative">
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#0A0A0A] px-2 text-xs text-red-500 uppercase font-bold">
                                    LEAKS
                                </div>
                            </div>

                            <div className="flex flex-col items-center">
                                <div className="w-16 h-16 bg-[#222] rounded-full flex items-center justify-center border border-[#333]">
                                    <Globe size={24} className="text-red-500" />
                                </div>
                                <span className="mt-2 text-sm text-gray-500">Public Server</span>
                            </div>
                         </div>
                    </div>
                </div>
            </motion.div>
        </div>
      </section>

      {/* SECTION 3: THE SOLUTION */}
      <section className="py-24 bg-[#050505] relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 relative z-10">
            <motion.div 
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                className="text-center mb-16"
            >
                <h2 className="text-4xl md:text-6xl font-black text-white mb-4">
                    THE <span className="text-[#FF9900]">ZERO-KNOWLEDGE</span> ADVANTAGE
                </h2>
                <p className="text-gray-400">Aleo blockchain powers the first truly private messenger.</p>
            </motion.div>

            <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
                {/* Standard Messengers */}
                <motion.div 
                    initial={{ x: -50, opacity: 0 }}
                    whileInView={{ x: 0, opacity: 1 }}
                    className="p-8 bg-[#0A0A0A] border border-[#222] rounded-3xl opacity-50 hover:opacity-100 transition-opacity"
                >
                    <h3 className="text-2xl font-bold mb-6 text-gray-400">Standard Apps</h3>
                    <ul className="space-y-4">
                        <li className="flex items-center gap-3 text-red-400">
                            <X size={20} /> Phone Number Required
                        </li>
                        <li className="flex items-center gap-3 text-red-400">
                            <X size={20} /> Metadata Stored
                        </li>
                        <li className="flex items-center gap-3 text-red-400">
                            <X size={20} /> Centralized Servers
                        </li>
                    </ul>
                </motion.div>

                {/* Ghost */}
                <motion.div 
                    initial={{ x: 50, opacity: 0 }}
                    whileInView={{ x: 0, opacity: 1 }}
                    className="p-8 bg-[#111] border border-[#FF9900] rounded-3xl shadow-[0_0_50px_-12px_rgba(255,153,0,0.3)] relative"
                >
                    <div className="absolute top-0 right-0 bg-[#FF9900] text-black text-xs font-bold px-3 py-1 rounded-bl-xl rounded-tr-2xl">
                        RECOMMENDED
                    </div>
                    <h3 className="text-2xl font-bold mb-6 text-white">Ghost Protocol</h3>
                    <ul className="space-y-4">
                        <li className="flex items-center gap-3 text-[#FF9900]">
                            <Check size={20} /> Wallet Authentication
                        </li>
                        <li className="flex items-center gap-3 text-[#FF9900]">
                            <Check size={20} /> ZK-Shielded Transactions
                        </li>
                        <li className="flex items-center gap-3 text-[#FF9900]">
                            <Check size={20} /> 100% Private Metadata
                        </li>
                    </ul>
                </motion.div>
            </div>
        </div>
      </section>

      {/* SECTION 4: WORKFLOW */}
      <section id="how-it-works" className="py-24 bg-[#0A0A0A] border-y border-[#1A1A1A]">
        <div className="max-w-7xl mx-auto px-4">
            <h2 className="text-4xl font-bold text-center mb-16">HOW IT WORKS</h2>
            
            <div className="grid md:grid-cols-3 gap-12 relative">
                {/* Connector Line */}
                <div className="hidden md:block absolute top-12 left-0 w-full h-1 bg-[#222] -z-0">
                    <div className="w-full h-full bg-gradient-to-r from-transparent via-[#FF9900] to-transparent opacity-20" />
                </div>

                {[
                    { title: "Connect Identity", icon: <Zap />, desc: "Sign in with your Aleo Wallet. No email, no phone." },
                    { title: "Add Node", icon: <Network />, desc: "Discover contacts via encrypted on-chain registry." },
                    { title: "Ghost Signal", icon: <Shield />, desc: "Send messages verified by ZK-Proofs. Invisible to observers." }
                ].map((step, i) => (
                    <motion.div 
                        key={i}
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.2 }}
                        className="relative z-10 flex flex-col items-center text-center bg-[#0A0A0A] p-6"
                    >
                        <div className="w-24 h-24 bg-[#111] rounded-2xl border border-[#333] flex items-center justify-center mb-6 group hover:border-[#FF9900] transition-colors shadow-xl">
                            <div className="text-gray-400 group-hover:text-[#FF9900] transition-colors scale-150">
                                {step.icon}
                            </div>
                        </div>
                        <h3 className="text-xl font-bold mb-2">{step.title}</h3>
                        <p className="text-gray-400 text-sm">{step.desc}</p>
                    </motion.div>
                ))}
            </div>
        </div>
      </section>

      {/* SECTION 5: DEEP TECH */}
      <section id="features" className="py-24 bg-[#050505]">
        <div className="max-w-7xl mx-auto px-4">
            <motion.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              className="text-center mb-16"
            >
              <h2 className="text-4xl md:text-5xl font-bold mb-4">FEATURES</h2>
              <p className="text-gray-500">Everything you need for private, decentralized communication.</p>
            </motion.div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[
                    { title: "Censorship Resistance", icon: <EyeOff />, desc: "Unstoppable communication powered by decentralized validators." },
                    { title: "On-Chain Encryption", icon: <Lock />, desc: "Every byte is encrypted with ECIES before it touches the network." },
                    { title: "Message Recovery", icon: <Box />, desc: "Your message history is recovered locally using your private key." },
                    { title: "Network Search", icon: <Search />, desc: "Find users without exposing your entire social graph." },
                    { title: "Channels", icon: <Radio />, desc: "Public broadcast channels for open discussion. Anyone can join and participate." },
                    { title: "Private Groups", icon: <Users />, desc: "Invite-only group chats with encrypted member lists and message history." }
                ].map((card, i) => (
                    <motion.div
                        key={i}
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.1 }}
                        whileHover={{ y: -5 }}
                        className="p-8 bg-[#0A0A0A] border border-[#222] hover:border-[#FF9900]/50 rounded-2xl transition-all group"
                    >
                        <div className="mb-4 p-3 bg-[#111] w-fit rounded-lg text-[#FF9900] group-hover:bg-[#FF9900] group-hover:text-black transition-colors">
                            {card.icon}
                        </div>
                        <h3 className="text-xl font-bold mb-2">{card.title}</h3>
                        <p className="text-gray-500">{card.desc}</p>
                    </motion.div>
                ))}
            </div>
        </div>
      </section>

      {/* SECTION 6: SECURITY ARCHITECTURE */}
      <section className="py-24 bg-[#0A0A0A] border-y border-[#1A1A1A]">
        <div className="max-w-5xl mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl md:text-5xl font-bold mb-4">SECURITY ARCHITECTURE</h2>
            <p className="text-gray-500">Multiple layers of protection for your communication.</p>
          </motion.div>

          <div className="space-y-4">
            {[
              { label: "Layer 1: Wallet Auth", desc: "No email, no phone. Identity = cryptographic key pair.", color: "#FF9900" },
              { label: "Layer 2: ECIES Encryption", desc: "Messages encrypted client-side before leaving your device.", color: "#FF7700" },
              { label: "Layer 3: ZK-Proofs", desc: "Aleo executes transitions with zero-knowledge proofs. Nobody sees your data.", color: "#FF5500" },
              { label: "Layer 4: Shielded Records", desc: "On-chain data is encrypted records. Only the owner can decrypt.", color: "#FF3300" },
            ].map((layer, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -30 }}
                whileInView={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.15 }}
                className="flex items-center gap-6 p-6 bg-[#111] rounded-2xl border border-[#222] hover:border-[#FF9900]/30 transition-colors"
              >
                <div className="w-12 h-12 rounded-xl flex items-center justify-center font-black text-lg text-black flex-shrink-0" style={{ backgroundColor: layer.color }}>
                  {i + 1}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">{layer.label}</h3>
                  <p className="text-gray-500 text-sm">{layer.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 6: FOOTER */}
      <section className="py-32 bg-black text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-[#FF9900]/20 via-transparent to-transparent opacity-50" />
        
        <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            whileInView={{ scale: 1, opacity: 1 }}
            className="relative z-10"
        >
            <Ghost size={64} className="mx-auto text-[#FF9900] mb-8 animate-bounce" />
            <h2 className="text-4xl md:text-7xl font-black mb-8">
                CLOSE THE GAP. <br/>
                COMMUNICATE IN PRIVATE.
            </h2>
            <button 
                onClick={onConnect}
                disabled={isConnecting}
                className="px-12 py-6 bg-[#FF9900] text-black text-xl font-bold rounded-full hover:scale-105 transition-transform shadow-[0_0_30px_rgba(255,153,0,0.4)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {isConnecting ? "CONNECTING..." : "LAUNCH GHOST APP"}
            </button>
            <p className="mt-8 text-gray-600 text-sm">
                Built on Aleo Testnet • Privacy by Design • Open Source
            </p>
        </motion.div>
      </section>
    </div>
  );
};

const UserIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>
    <circle cx="12" cy="7" r="4"/>
  </svg>
);

export default LandingPage;
