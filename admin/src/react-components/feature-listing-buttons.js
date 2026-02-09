import React from "react";
import PropTypes from "prop-types";
import { connect } from "react-redux";
import Button from "@material-ui/core/Button";
import { UPDATE } from "react-admin";
import { listingFeature, listingUnfeature } from "./listing-actions";

const isFeatured = record => (record.tags ? (record.tags.tags || []).includes("featured") : false);

function FeatureListingButton(props) {
  const { feature, unfeature, record, resource } = props;
  const featured = isFeatured(record);
  const label = featured ? "Unfeature" : "Feature";
  return (
    <Button
      label={label}
      onClick={async () => {
        // featured_* views require allow_promotion on the underlying object (avatar/scene).
        // Make "Feature" do the right thing without requiring a separate manual step in Avatars/Scenes.
        if (!featured) {
          try {
            const dataProvider = window.APP && window.APP.dataProvider;
            if (dataProvider) {
              if (resource === "avatar_listings" && record && record.avatar_id) {
                await dataProvider(UPDATE, "avatars", { id: record.avatar_id, data: { allow_promotion: true } });
              } else if (resource === "scene_listings" && record && record.scene_id) {
                await dataProvider(UPDATE, "scenes", { id: record.scene_id, data: { allow_promotion: true } });
              }

              // Featured lists only include active listings. If a listing is delisted, "Feature" should
              // activate it so it shows up immediately (and also in user avatar pickers).
              if (record && record.id) {
                await dataProvider(UPDATE, resource, { id: record.id, data: { state: "active" } });
              }
            }
          } catch (e) {
            console.warn("Failed to set allow_promotion for featured listing.", e);
          }
        }

        (featured ? unfeature : feature)(resource, record.id, record);
      }}
    >
      {label}
    </Button>
  );
}

FeatureListingButton.propTypes = {
  feature: PropTypes.func.isRequired,
  unfeature: PropTypes.func.isRequired,
  resource: PropTypes.string.isRequired,
  record: PropTypes.object
};

const withStaticProps = staticProps => (stateProps, dispatchProps, ownProps) => ({
  ...ownProps,
  ...stateProps,
  ...dispatchProps,
  ...staticProps
});

export const FeatureSceneListingButton = connect(
  null,
  { feature: listingFeature, unfeature: listingUnfeature },
  withStaticProps({ resource: "scene_listings" })
)(FeatureListingButton);

export const FeatureAvatarListingButton = connect(
  null,
  { feature: listingFeature, unfeature: listingUnfeature },
  withStaticProps({ resource: "avatar_listings" })
)(FeatureListingButton);
