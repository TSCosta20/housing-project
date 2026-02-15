package com.tsc.imowatch.data

import com.squareup.moshi.Json

data class SessionResponse(
    @Json(name = "access_token") val accessToken: String?,
    @Json(name = "refresh_token") val refreshToken: String?,
    @Json(name = "token_type") val tokenType: String?,
    val user: UserDto?
)

data class UserDto(
    val id: String,
    val email: String?
)

data class PasswordLoginRequest(
    val email: String,
    val password: String
)

data class MagicLinkRequest(
    val email: String,
    @Json(name = "create_user") val createUser: Boolean = true
)

data class ZoneDto(
    val id: String? = null,
    @Json(name = "user_id") val userId: String,
    val name: String,
    @Json(name = "zone_type") val zoneType: String,
    @Json(name = "center_lat") val centerLat: Double? = null,
    @Json(name = "center_lng") val centerLng: Double? = null,
    @Json(name = "radius_meters") val radiusMeters: Int? = null,
    @Json(name = "admin_codes") val adminCodes: Map<String, Any>? = null,
    @Json(name = "polygon_geojson") val polygonGeojson: Map<String, Any>? = null,
    val filters: Map<String, Any> = emptyMap(),
    @Json(name = "is_active") val isActive: Boolean = true
)

data class ZoneDailyStatsDto(
    @Json(name = "zone_id") val zoneId: String,
    @Json(name = "stats_date") val statsDate: String,
    @Json(name = "p10_ratio_years") val p10RatioYears: Double?,
    @Json(name = "p50_ratio_years") val p50RatioYears: Double?,
    @Json(name = "p90_ratio_years") val p90RatioYears: Double?,
    @Json(name = "eligible_buy_count") val eligibleBuyCount: Int,
    @Json(name = "eligible_rent_count") val eligibleRentCount: Int
)

data class ListingScoringDto(
    @Json(name = "zone_id") val zoneId: String,
    @Json(name = "listing_id") val listingId: String,
    @Json(name = "ratio_years") val ratioYears: Double,
    @Json(name = "estimated_monthly_rent_eur") val estimatedMonthlyRentEur: Double,
    @Json(name = "is_deal_p10") val isDealP10: Boolean,
    @Json(name = "rank_in_zone") val rankInZone: Int?
)

data class ListingNormalizedDto(
    val id: String,
    val title: String?,
    @Json(name = "source") val source: String,
    @Json(name = "price_eur") val priceEur: Double,
    @Json(name = "contact_phone") val contactPhone: String?,
    @Json(name = "contact_email") val contactEmail: String?,
    val url: String?
)

data class ProfileDto(
    @Json(name = "user_id") val userId: String,
    val name: String? = null,
    @Json(name = "default_alert_channel") val defaultAlertChannel: String = "both",
    @Json(name = "email_template_subject") val emailTemplateSubject: String? = null,
    @Json(name = "email_template_body") val emailTemplateBody: String? = null
)

data class DeviceTokenDto(
    @Json(name = "user_id") val userId: String,
    @Json(name = "device_token") val deviceToken: String,
    val platform: String = "android"
)
