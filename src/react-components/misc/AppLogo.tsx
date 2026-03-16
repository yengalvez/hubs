import React, { useEffect, useState } from "react";

import configs from "../../utils/configs";
import { ReactComponent as HmcLogo } from "../icons/HmcLogo.svg";
import { isHmc } from "../../utils/isHmc";
import { useLogo } from "../styles/theme";

export function AppLogo({ className }: { className?: string }) {
  const logo = useLogo();
  const [resolvedLogo, setResolvedLogo] = useState(logo || "");

  // Display HMC logo if account is HMC and no custom logo is configured
  const shouldDisplayHmcLogo = isHmc() && !logo;

  useEffect(() => {
    setResolvedLogo(logo || "");
  }, [logo]);

  const onLogoError = () => {
    setResolvedLogo("");
  };

  return shouldDisplayHmcLogo ? (
    <HmcLogo className="hmc-logo" />
  ) : !resolvedLogo ? (
    <span className={className}>{configs.translation("app-name")}</span>
  ) : (
    <img className={className} alt={configs.translation("app-name")} src={resolvedLogo} onError={onLogoError} />
  );
}
