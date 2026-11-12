import { useReveal } from './useReveal.ts';
import Nav from './components/Nav.tsx';
import Hero from './components/Hero.tsx';
import BuiltOn from './components/BuiltOn.tsx';
import WhyEmulsion from './components/WhyEmulsion.tsx';
import Foundations from './components/Foundations.tsx';
import LocalAI from './components/LocalAI.tsx';
import Download from './components/Download.tsx';
import Faq from './components/Faq.tsx';
import Footer from './components/Footer.tsx';

export default function App() {
  useReveal();
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <BuiltOn />
        <WhyEmulsion />
        <Foundations />
        <LocalAI />
        <Download />
        <Faq />
      </main>
      <Footer />
    </>
  );
}
