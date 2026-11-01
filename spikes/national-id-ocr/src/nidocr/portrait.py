"""The holder's photograph, cut out of the front of the card."""

from __future__ import annotations

import cv2
import numpy as np

_CASCADE: cv2.CascadeClassifier | None = None


def _cascade() -> cv2.CascadeClassifier:
    global _CASCADE  # noqa: PLW0603 - load once; the classifier is read-only after that
    if _CASCADE is None:
        _CASCADE = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        )
    return _CASCADE


#: A face this large in the photo, with almost no text, is a photo of a person, not of a document.
FACE_FILLS_FRAME = 0.06


def face_fills_frame(image: np.ndarray) -> bool:
    """Is most of this photo one face (a selfie, a portrait), rather than a document?"""
    grey = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    height, width = grey.shape[:2]
    scale = min(1.0, 800 / max(height, width, 1))
    if scale < 1.0:
        grey = cv2.resize(grey, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        height, width = grey.shape[:2]
    smallest = max(24, int(min(height, width) * 0.15))
    faces = _cascade().detectMultiScale(cv2.equalizeHist(grey), scaleFactor=1.1, minNeighbors=6, minSize=(smallest, smallest))
    return any(w * h / float(width * height) >= FACE_FILLS_FRAME for _, _, w, h in faces)


def find_portrait(front: np.ndarray) -> np.ndarray | None:
    """The printed portrait from an upright front of the card, or None if no face is found."""
    grey = cv2.cvtColor(front, cv2.COLOR_BGR2GRAY) if front.ndim == 3 else front
    height, width = grey.shape[:2]
    smallest = max(24, int(min(height, width) * 0.08))
    faces = _cascade().detectMultiScale(
        cv2.equalizeHist(grey), scaleFactor=1.1, minNeighbors=6, minSize=(smallest, smallest)
    )
    if len(faces) == 0:
        return None
    # The card's own portrait is the largest face; anything else is a smaller ghost image or noise.
    x, y, w, h = max(faces, key=lambda face: face[2] * face[3])
    centre_x = x + w / 2
    left = int(max(0, centre_x - w * 0.9))
    right = int(min(width, centre_x + w * 0.9))
    top = int(max(0, y - h * 0.55))
    bottom = int(min(height, y + h * 1.55))
    return front[top:bottom, left:right].copy()
