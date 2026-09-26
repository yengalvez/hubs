import React from "react";
import PropTypes from "prop-types";
import { useIntl } from "react-intl";
import configs from "../utils/configs";

export function AvatarPageLogo({ className }) {
  const intl = useIntl();
  const logoUrl = configs.image("logo");
  if (!logoUrl) return null;

  return (
    <img
      className={className}
      src={logoUrl}
      alt={intl.formatMessage({ id: "avatar-page.logo", defaultMessage: "Logo" })}
    />
  );
}

AvatarPageLogo.propTypes = {
  className: PropTypes.string
};
