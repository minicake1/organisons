import type { ReactNode } from "react";
import { Box, Checkbox, Collapse, Group, Text } from "@mantine/core";
import { IconChevronDown } from "@tabler/icons-react";
import * as maplibregl from "maplibre-gl";
import type { PoiKind } from "../api";
import { poiKind } from "../labels";

/**
 * Catégorie de POI dans une liste (fiche d'une trace, onglet POI) : bandeau de
 * la couleur de la catégorie, collé en haut pendant le défilement, repliable.
 */
export function PoiCategory({
  kind,
  count,
  folded,
  onFold,
  check,
  children,
}: {
  kind: PoiKind;
  /** Texte du compteur (par exemple « 3/8 » ou « 12 »). */
  count: string;
  folded: boolean;
  onFold: () => void;
  /** Case de l'en-tête (afficher ou sélectionner toute la catégorie), facultative. */
  check?: {
    checked: boolean;
    indeterminate: boolean;
    onChange: (v: boolean) => void;
    label: string;
  };
  children: ReactNode;
}) {
  const k = poiKind(kind);
  return (
    <Box>
      {/* Fond du cadre autour du bandeau collé : rien ne se voit au-dessus ni dans ses coins arrondis. */}
      <Box
        pt={6}
        style={{
          position: "sticky",
          top: 0,
          zIndex: 1,
          background: "var(--mantine-color-body)",
        }}
      >
        <Group
          gap={8}
          px={8}
          py={6}
          wrap="nowrap"
          style={{ background: k.color, borderRadius: 8 }}
        >
          {check && (
            <Checkbox
              size="xs"
              color="dark"
              styles={{ input: { borderColor: "#fff" } }}
              checked={check.checked}
              indeterminate={check.indeterminate}
              onChange={(e) => check.onChange(e.currentTarget.checked)}
              aria-label={check.label}
            />
          )}
          {/* Clic sur l'en-tête : replier ou déplier la catégorie. */}
          <Group
            gap={8}
            wrap="nowrap"
            role="button"
            tabIndex={0}
            aria-expanded={!folded}
            style={{ flex: 1, cursor: "pointer", userSelect: "none" }}
            onClick={onFold}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onFold();
              }
            }}
          >
            <Text size="sm" fw={700} c="white" style={{ flex: 1 }}>
              {k.label}
            </Text>
            <Text size="xs" c="white" opacity={0.85}>
              {count}
            </Text>
            <IconChevronDown
              size={16}
              color="white"
              style={{
                transition: "transform 0.15s",
                transform: folded ? "rotate(-90deg)" : "none",
              }}
            />
          </Group>
        </Group>
      </Box>
      <Collapse in={!folded} transitionDuration={150}>
        <Box pl={4}>{children}</Box>
      </Collapse>
    </Box>
  );
}

/** Pastille de catégorie d'une ligne de POI (entourée : catégorie choisie). */
export function PoiDot({
  kind,
  chosen,
  size = 10,
}: {
  kind: PoiKind;
  chosen?: boolean;
  size?: number;
}) {
  return (
    <Box
      w={size}
      h={size}
      style={{
        borderRadius: "50%",
        background: poiKind(kind).color,
        flex: "none",
        border: chosen ? "2px solid var(--mantine-color-text)" : undefined,
      }}
    />
  );
}

/** Info-bulle des POI sur une carte : fond de la couleur de la catégorie. */
export function poiTip() {
  return new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    className: "poi-tip",
    offset: 14,
    maxWidth: "260px",
  });
}

export function showPoiTip(
  map: maplibregl.Map,
  tip: maplibregl.Popup,
  p: { name: string; kind: PoiKind; lat: number; lon: number },
  meta: string,
) {
  const k = poiKind(p.kind);
  const box = document.createElement("div");
  const name = document.createElement("div");
  name.className = "poi-tip-name";
  name.textContent = p.name || "(sans nom)";
  const sub = document.createElement("div");
  sub.className = "poi-tip-meta";
  sub.textContent = `${k.label} · ${meta}`;
  box.append(name, sub);
  tip
    .setOffset(k.big ? 30 : 12)
    .setLngLat([p.lon, p.lat])
    .setDOMContent(box)
    .addTo(map);
  tip.getElement()?.style.setProperty("--poi-color", k.color);
}

/**
 * Repère d'un POI sur une carte, identique partout : grandes catégories
 * (contrôles, attention) en épingle avec leur nom, les autres en pastille.
 */
export function poiMarker(
  map: maplibregl.Map,
  tip: maplibregl.Popup,
  p: { name: string; kind: PoiKind; lat: number; lon: number },
  meta: string,
  onClick?: () => void,
): maplibregl.Marker {
  const k = poiKind(p.kind);
  const el = document.createElement("div");
  let target: HTMLElement = el;
  let marker: maplibregl.Marker;
  if (k.big) {
    el.className = "poi-big";
    const label = document.createElement("span");
    label.className = "label";
    label.style.background = k.color;
    label.textContent = p.name;
    const pin = document.createElement("span");
    pin.className = "pin";
    pin.style.background = k.color;
    pin.textContent = p.kind === "control" ? "✓" : "!";
    el.append(label, pin);
    target = pin;
    marker = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat(
      [p.lon, p.lat],
    );
  } else {
    el.className = "poi-small";
    el.style.background = k.color;
    marker = new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]);
  }
  target.addEventListener("mouseenter", () => showPoiTip(map, tip, p, meta));
  target.addEventListener("mouseleave", () => tip.remove());
  if (onClick)
    target.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
  return marker.addTo(map);
}
