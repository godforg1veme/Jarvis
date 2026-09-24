PERFORMANCE_PROFILES = {
    "quality": {"beam_size": 5, "vad_filter": True},
    "efficient": {"beam_size": 1, "vad_filter": False},
}


def resolve_performance_profile(settings):
    profile = str(settings.get("performanceProfile") or "quality").strip().lower()
    if profile in PERFORMANCE_PROFILES:
        values = PERFORMANCE_PROFILES[profile]
        return profile, values["beam_size"], values["vad_filter"]
    if profile != "custom":
        raise ValueError(
            f"Unknown fasterWhisper.performanceProfile: {profile}. "
            "Expected quality, efficient, or custom."
        )

    beam_size = settings.get("beamSize", 5)
    if isinstance(beam_size, bool) or not isinstance(beam_size, int) or beam_size < 1:
        raise ValueError(
            "fasterWhisper.beamSize must be an integer of at least 1 in custom mode."
        )
    vad_filter = settings.get("vadFilter", True)
    if not isinstance(vad_filter, bool):
        raise ValueError("fasterWhisper.vadFilter must be boolean in custom mode.")
    return profile, beam_size, vad_filter
