import Head from "next/head";
import { Montserrat } from "next/font/google";
import "../styles/globals.css";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["400", "800", "900"],
  display: "swap",
  variable: "--font-montserrat",
});

export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div className={montserrat.variable}>
        <div className="gss-brand" aria-label="Gold Street Solutions">
          Gold Street Solutions
        </div>
        <Component {...pageProps} />
      </div>
      <style jsx global>{`
        .gss-brand {
          position: fixed;
          top: 0;
          right: 0;
          z-index: 9999;
          padding: 0.35rem 0.85rem;
          background: transparent;
          color: #aa915a;
          font-family: var(--font-montserrat, sans-serif);
          font-size: 0.72rem;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          pointer-events: none;
          user-select: none;
        }
      `}</style>
    </>
  );
}
