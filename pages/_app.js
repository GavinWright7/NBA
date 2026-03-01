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
        <Component {...pageProps} />
      </div>
    </>
  );
}
