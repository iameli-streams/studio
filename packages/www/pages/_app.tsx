import Head from "next/head";
import { DefaultSeo } from "next-seo";
import SEO from "../next-seo.config";
import { ApiProvider } from "hooks/use-api";
import { AnalyzerProvider } from "hooks/use-analyzer";
import { QueryClient, QueryClientProvider } from "react-query";
import { MetaMaskProvider } from "metamask-react";
import "../css/recaptcha.css";
import React from "react";
import {
  globalCss,
  getThemes,
  SnackbarProvider,
  DesignSystemProvider,
} from "@livepeer/design-system";
import { ThemeProvider } from "next-themes";
import { DEFAULT_THEME } from "../lib/theme";
import {
  createReactClient,
  LivepeerConfig,
  studioProvider,
  ThemeConfig,
} from "@livepeer/react";
import "../css/hubspot.scss";
import { isStaging } from "lib/utils";

const queryClient = new QueryClient();

const globalStyles = globalCss({
  body: {
    margin: 0,
    bc: "$loContrast",
    fontFamily: "Inter",
    color: "$hiContrast",
  },

  ".main": {
    bc: "$loContrast",
  },

  "h1, h2, h3, h4, h5": { fontWeight: 500 },

  svg: { display: "block" },

  "pre, code": { margin: 0, fontFamily: "$mono" },

  "#__next": {
    position: "relative",
    zIndex: 0,
  },

  "#hubspot-messages-iframe-container iframe": {
    colorScheme: "auto",
  },
});

const themes: any = getThemes();
const themeMap = {};
Object.keys(themes).map(
  (key, _index) => (themeMap[themes[key].className] = themes[key].className)
);

const livepeerClient = createReactClient({
  provider: studioProvider({
    // we intentionally provide no API key so any requests requiring auth will fail
    // eventually should move to using JWT from user's login
    apiKey: "",
    baseUrl: isStaging()
      ? "https://livepeer.monster"
      : "https://livepeer.studio",
  }),
});

const livepeerTheme: ThemeConfig = {
  colors: {
    accent: "$colors$green10",
  },
};

const App = ({ Component, pageProps }) => {
  globalStyles();
  return (
    <>
      <title>Livepeer Studio</title>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </Head>
      <DesignSystemProvider>
        <ThemeProvider
          forcedTheme={Component.theme || undefined}
          disableTransitionOnChange
          attribute="class"
          defaultTheme={DEFAULT_THEME}
          value={{
            ...themeMap,
            dark: "dark-theme-green",
            light: "light-theme-green",
          }}>
          <SnackbarProvider>
            <QueryClientProvider client={queryClient}>
              <MetaMaskProvider>
                <ApiProvider>
                  <AnalyzerProvider>
                    <LivepeerConfig
                      theme={livepeerTheme}
                      client={livepeerClient}>
                      <DefaultSeo {...SEO} />
                      <Component {...pageProps} />
                    </LivepeerConfig>
                  </AnalyzerProvider>
                </ApiProvider>
              </MetaMaskProvider>
            </QueryClientProvider>
          </SnackbarProvider>
        </ThemeProvider>
      </DesignSystemProvider>
    </>
  );
};

export default App;
