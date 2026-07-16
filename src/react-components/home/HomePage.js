import React, { useContext, useEffect, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRight } from "@fortawesome/free-solid-svg-icons/faArrowRight";
import { faBolt } from "@fortawesome/free-solid-svg-icons/faBolt";
import { faCube } from "@fortawesome/free-solid-svg-icons/faCube";
import { faRobot } from "@fortawesome/free-solid-svg-icons/faRobot";
import { faShieldAlt } from "@fortawesome/free-solid-svg-icons/faShieldAlt";
import { faUsers } from "@fortawesome/free-solid-svg-icons/faUsers";
import configs from "../../utils/configs";
import { CreateRoomButton } from "./CreateRoomButton";
import { PWAButton } from "./PWAButton";
import { useFavoriteRooms } from "./useFavoriteRooms";
import { usePublicRooms } from "./usePublicRooms";
import styles from "./HomePage.scss";
import { AuthContext } from "../auth/AuthContext";
import { createAndRedirectToNewHub } from "../../utils/phoenix-utils";
import { MediaGrid } from "../room/MediaGrid";
import { MediaTile } from "../room/MediaTiles";
import { PageContainer } from "../layout/PageContainer";
import { scaledThumbnailUrlFor } from "../../utils/media-url-utils";
import { Column } from "../layout/Column";
import { Container } from "../layout/Container";
import { SocialBar } from "../home/SocialBar";
import { SignInButton } from "./SignInButton";
import { AppLogo } from "../misc/AppLogo";
import { isHmc } from "../../utils/isHmc";
import maskEmail from "../../utils/mask-email";
import homeHeroBackground from "../../assets/images/home-hero-background-unbranded.png";

export function HomePage() {
  const auth = useContext(AuthContext);
  const intl = useIntl();

  const { results: favoriteRooms } = useFavoriteRooms();
  const { results: publicRooms } = usePublicRooms();

  const sortedFavoriteRooms = Array.from(favoriteRooms).sort((a, b) => b.member_count - a.member_count);
  const sortedPublicRooms = Array.from(publicRooms).sort((a, b) => b.member_count - a.member_count);

  useEffect(() => {
    const qs = new URLSearchParams(location.search);

    // Support legacy sign in urls.
    if (qs.has("sign_in")) {
      const redirectUrl = new URL("/signin", window.location);
      redirectUrl.search = location.search;
      window.location = redirectUrl;
    } else if (qs.has("auth_topic")) {
      const redirectUrl = new URL("/verify", window.location);
      redirectUrl.search = location.search;
      window.location = redirectUrl;
    }

    if (qs.has("new")) {
      qs.delete("new");
      createAndRedirectToNewHub(null, null, true, qs);
    }
  }, []);

  useEffect(() => {
    document.body.classList.add("is-home-page");
    return () => document.body.classList.remove("is-home-page");
  }, []);

  const canCreateRooms = !configs.feature("disable_room_creation") || auth.isAdmin;
  const email = auth.email;
  const configuredHeroImage = configs.image("home_background");
  const [heroImageSrc, setHeroImageSrc] = useState(configuredHeroImage || homeHeroBackground);
  const [heroImageHidden, setHeroImageHidden] = useState(false);

  useEffect(() => {
    setHeroImageSrc(configuredHeroImage || homeHeroBackground);
    setHeroImageHidden(false);
  }, [configuredHeroImage]);

  return (
    <PageContainer className={styles.homePage}>
      <div className={styles.ambientGlow} aria-hidden="true" />
      <Container className={styles.heroShell}>
        <div className={styles.hero}>
          <div className={styles.mobileHeader}>
            <div className={styles.logoContainer}>
              <AppLogo />
            </div>
            {auth.isSignedIn ? (
              <div className={styles.signInContainer}>
                <span>
                  <FormattedMessage
                    id="header.signed-in-as"
                    defaultMessage="Signed in as {email}"
                    values={{ email: maskEmail(email) }}
                  />
                </span>
                <a href="#" onClick={auth.signOut} className={styles.mobileSignOut}>
                  <FormattedMessage id="header.sign-out" defaultMessage="Sign Out" />
                </a>
              </div>
            ) : (
              <SignInButton mobile />
            )}
          </div>

          <div className={styles.appInfo}>
            <div className={styles.eyebrow}>
              <span className={styles.liveDot} aria-hidden="true" />
              <FormattedMessage
                id="home-page.portal-eyebrow"
                defaultMessage="Social metaverse, directly in your browser"
              />
            </div>
            <h1 className={styles.heroTitle}>
              <FormattedMessage
                id="home-page.portal-title"
                defaultMessage="Enter a world, <accent>not another video call.</accent>"
                values={{ accent: chunks => <span>{chunks}</span> }}
              />
            </h1>
            <p className={styles.heroLead}>
              <FormattedMessage
                id="home-page.portal-description"
                defaultMessage="Create private 3D spaces with full-body avatars, spatial audio and AI agents. No downloads and no friction."
              />
            </p>
            <div className={styles.heroActions}>
              {canCreateRooms && (
                <div className={styles.primaryAction}>
                  <CreateRoomButton />
                </div>
              )}
              {sortedPublicRooms.length > 0 && (
                <a className={styles.secondaryAction} href="#public-rooms">
                  <FormattedMessage id="home-page.explore-rooms" defaultMessage="Explore open rooms" />
                  <FontAwesomeIcon icon={faArrowRight} />
                </a>
              )}
            </div>
            <PWAButton />
            <div
              className={styles.proofPoints}
              aria-label={intl.formatMessage({
                id: "home-page.platform-benefits",
                defaultMessage: "Platform benefits"
              })}
            >
              <span>
                <FontAwesomeIcon icon={faBolt} />
                <FormattedMessage id="home-page.no-downloads" defaultMessage="No downloads" />
              </span>
              <span>
                <FontAwesomeIcon icon={faCube} />
                <FormattedMessage id="home-page.fullbody-avatars" defaultMessage="Full-body avatars" />
              </span>
              <span>
                <FontAwesomeIcon icon={faRobot} />
                <FormattedMessage id="home-page.ai-agents" defaultMessage="AI agents" />
              </span>
            </div>
          </div>

          <div className={styles.portalStage}>
            <div className={styles.portalHalo} aria-hidden="true" />
            <div className={styles.portalFrame}>
              <div className={styles.portalTopbar}>
                <span>
                  <span className={styles.liveDot} aria-hidden="true" />
                  <FormattedMessage id="home-page.live-experience" defaultMessage="Live experience" />
                </span>
                <span className={styles.portalSignal} aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
              <div className={styles.heroImageContainer}>
                {heroImageHidden ? (
                  <div className={styles.heroImageFallback} aria-hidden="true" />
                ) : (
                  <img
                    alt={intl.formatMessage(
                      {
                        id: "home-page.hero-image-alt",
                        defaultMessage: "Screenshot of {appName}"
                      },
                      { appName: configs.translation("app-name") }
                    )}
                    src={heroImageSrc}
                    onError={() => {
                      if (heroImageSrc !== homeHeroBackground) {
                        setHeroImageSrc(homeHeroBackground);
                        return;
                      }
                      setHeroImageHidden(true);
                    }}
                  />
                )}
                <div className={styles.imageOverlay} aria-hidden="true" />
                <div className={styles.roomBadge}>
                  <span className={styles.roomBadgeIcon}>
                    <FontAwesomeIcon icon={faUsers} />
                  </span>
                  <span>
                    <small>
                      <FormattedMessage id="home-page.shared-presence" defaultMessage="Shared presence" />
                    </small>
                    <strong>
                      <FormattedMessage id="home-page.inside-the-world" defaultMessage="Inside the world" />
                    </strong>
                  </span>
                </div>
              </div>
              <div className={styles.portalFooter}>
                <span>
                  <FormattedMessage id="home-page.spatial-audio" defaultMessage="Spatial audio" />
                </span>
                <span>
                  <FormattedMessage id="home-page.desktop-mobile-vr" defaultMessage="Desktop · Mobile · VR" />
                </span>
              </div>
            </div>
            <div className={styles.floatingCard}>
              <FontAwesomeIcon icon={faRobot} />
              <span>
                <small>
                  <FormattedMessage id="home-page.virtual-agents" defaultMessage="Virtual agents" />
                </small>
                <strong>
                  <FormattedMessage id="home-page.present-and-active" defaultMessage="Present and active" />
                </strong>
              </span>
            </div>
          </div>
        </div>
      </Container>

      <Container className={styles.experienceSection}>
        <div className={styles.sectionIntro}>
          <span className={styles.sectionEyebrow}>
            <FormattedMessage id="home-page.beyond-the-screen" defaultMessage="Beyond the screen" />
          </span>
          <h2>
            <FormattedMessage id="home-page.experience-title" defaultMessage="A space designed to feel inhabited" />
          </h2>
          <p>
            <FormattedMessage
              id="home-page.experience-description"
              defaultMessage="Meet, create and explore in an environment where presence matters as much as content."
            />
          </p>
        </div>
        <div className={styles.experienceGrid}>
          <article className={styles.experienceCard}>
            <div className={styles.cardNumber}>01</div>
            <div className={styles.cardIcon}>
              <FontAwesomeIcon icon={faUsers} />
            </div>
            <h3>
              <FormattedMessage id="home-page.presence-title" defaultMessage="Presence that feels real" />
            </h3>
            <p>
              <FormattedMessage
                id="home-page.presence-description"
                defaultMessage="Full-body avatars, spatial voice and movement turn every encounter into a shared moment."
              />
            </p>
          </article>
          <article className={styles.experienceCard}>
            <div className={styles.cardNumber}>02</div>
            <div className={styles.cardIcon}>
              <FontAwesomeIcon icon={faRobot} />
            </div>
            <h3>
              <FormattedMessage id="home-page.agents-title" defaultMessage="Agents that inhabit the space" />
            </h3>
            <p>
              <FormattedMessage
                id="home-page.agents-description"
                defaultMessage="Talk privately with AI characters that move through the room and can take part in the experience."
              />
            </p>
          </article>
          <article className={styles.experienceCard}>
            <div className={styles.cardNumber}>03</div>
            <div className={styles.cardIcon}>
              <FontAwesomeIcon icon={faShieldAlt} />
            </div>
            <h3>
              <FormattedMessage id="home-page.control-title" defaultMessage="Your space, your rules" />
            </h3>
            <p>
              <FormattedMessage
                id="home-page.control-description"
                defaultMessage="Create private or public rooms, choose the scene and control who participates, all from the browser."
              />
            </p>
          </article>
        </div>
      </Container>

      <Container className={styles.signalStrip}>
        <div>
          <strong>
            <FormattedMessage id="home-page.browser-native" defaultMessage="Browser native" />
          </strong>
          <span>
            <FormattedMessage id="home-page.instant-access" defaultMessage="Instant access" />
          </span>
        </div>
        <div>
          <strong>
            <FormattedMessage id="home-page.real-time-3d" defaultMessage="Real-time 3D" />
          </strong>
          <span>
            <FormattedMessage id="home-page.shared-worlds" defaultMessage="Shared worlds" />
          </span>
        </div>
        <div>
          <strong>
            <FormattedMessage id="home-page.owned-infrastructure" defaultMessage="Owned infrastructure" />
          </strong>
          <span>
            <FormattedMessage id="home-page.controlled-platform" defaultMessage="A platform under your control" />
          </span>
        </div>
      </Container>

      {sortedPublicRooms.length > 0 && (
        <Container id="public-rooms" className={styles.roomsContainer}>
          <div className={styles.roomsHeader}>
            <div>
              <span className={styles.sectionEyebrow}>
                <FormattedMessage id="home-page.open-now" defaultMessage="Open now" />
              </span>
              <h2>
                <FormattedMessage id="home-page.explore-title" defaultMessage="Explore what is happening" />
              </h2>
            </div>
            <span className={styles.roomCount}>
              {sortedPublicRooms.length}{" "}
              <FormattedMessage
                id="home-page.available-room-count"
                defaultMessage="{count, plural, one {room} other {rooms}}"
                values={{ count: sortedPublicRooms.length }}
              />
            </span>
          </div>
          <Column grow padding className={styles.rooms}>
            <MediaGrid center>
              {sortedPublicRooms.map(room => {
                return (
                  <MediaTile
                    key={room.id}
                    entry={room}
                    processThumbnailUrl={(entry, width, height) =>
                      scaledThumbnailUrlFor(entry.images.preview.url, width, height)
                    }
                  />
                );
              })}
            </MediaGrid>
          </Column>
        </Container>
      )}

      {sortedFavoriteRooms.length > 0 && (
        <Container className={styles.roomsContainer}>
          <div className={styles.roomsHeader}>
            <div>
              <span className={styles.sectionEyebrow}>
                <FormattedMessage id="home-page.your-collection" defaultMessage="Your collection" />
              </span>
              <h2>
                <FormattedMessage id="home-page.favorite-rooms" defaultMessage="Favorite Rooms" />
              </h2>
            </div>
          </div>
          <Column grow padding className={styles.rooms}>
            <MediaGrid center>
              {sortedFavoriteRooms.map(room => {
                return (
                  <MediaTile
                    key={room.id}
                    entry={room}
                    processThumbnailUrl={(entry, width, height) =>
                      scaledThumbnailUrlFor(entry.images.preview.url, width, height)
                    }
                  />
                );
              })}
            </MediaGrid>
          </Column>
        </Container>
      )}

      {canCreateRooms && (
        <Container className={styles.finalCta}>
          <div className={styles.finalCtaCopy}>
            <span className={styles.sectionEyebrow}>
              <FormattedMessage id="home-page.your-next-space" defaultMessage="Your next space" />
            </span>
            <h2>
              <FormattedMessage id="home-page.ready-title" defaultMessage="Ready to open a new world?" />
            </h2>
            <p>
              <FormattedMessage
                id="home-page.ready-description"
                defaultMessage="Create a room in seconds and invite others with a link."
              />
            </p>
          </div>
          <div className={styles.finalCtaAction}>
            <CreateRoomButton />
          </div>
        </Container>
      )}

      {isHmc() ? (
        <Column center>
          <SocialBar />
        </Column>
      ) : null}
    </PageContainer>
  );
}
