
import * as React from "react"

const MOBILE_BREAKPOINT = 768 // md breakpoint in Tailwind

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(() => {
    // Check for window existence for SSR compatibility
    if (typeof window !== "undefined") {
      return window.innerWidth < MOBILE_BREAKPOINT;
    }
    return false; // Default for non-browser environments
  });

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleResize = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };

    window.addEventListener("resize", handleResize);
    // Call handler right away so state gets updated with initial window size
    handleResize();

    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return isMobile;
}
