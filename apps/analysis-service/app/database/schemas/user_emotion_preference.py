from datetime import date
from odmantic import Model


class UserEmotionPreference(Model):
    userId: str

    preferredEmotions: list[str]
    avoidEmotions: list[str]
    allowHealingContent: bool
    allowMentalAlert: bool

    updatedAt: date