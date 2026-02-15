package com.tsc.imowatch.data

import android.net.Uri
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class AuthRepository {
    private val authApi = SupabaseApis.authApi()
    var accessToken: String? = null
        private set
    var userId: String? = null
        private set

    suspend fun loginWithPassword(email: String, password: String): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            val session = authApi.loginWithPassword(PasswordLoginRequest(email = email, password = password))
            accessToken = session.accessToken
            userId = session.user?.id
            require(!accessToken.isNullOrBlank()) { "No access token returned." }
        }
    }

    suspend fun sendMagicLink(email: String): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            authApi.sendMagicLink(MagicLinkRequest(email = email, createUser = true))
        }
    }

    suspend fun completeMagicLink(deepLink: String): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            val token = extractAccessToken(deepLink)
            require(!token.isNullOrBlank()) { "Magic link token missing." }
            accessToken = token
            val user = authApi.getCurrentUser("Bearer $token")
            userId = user.id
        }
    }

    private fun extractAccessToken(deepLink: String): String? {
        val uri = Uri.parse(deepLink)
        uri.getQueryParameter("access_token")?.let { return it }

        val fragment = uri.fragment ?: return null
        fragment.split("&")
            .mapNotNull {
                val parts = it.split("=", limit = 2)
                if (parts.size == 2) parts[0] to parts[1] else null
            }
            .firstOrNull { it.first == "access_token" }
            ?.second
            ?.let { encoded ->
                return URLDecoder.decode(encoded, StandardCharsets.UTF_8)
            }

        return null
    }
}

class AppRepository(private val authRepository: AuthRepository) {
    private fun restApi(): SupabaseRestApi {
        val token = authRepository.accessToken ?: error("Not authenticated")
        return SupabaseApis.restApi(token)
    }

    suspend fun listZones(): List<ZoneDto> = withContext(Dispatchers.IO) {
        val token = authRepository.accessToken ?: return@withContext emptyList()
        restApi().listZones(bearer = "Bearer $token")
    }

    suspend fun createZone(zone: ZoneDto): ZoneDto? = withContext(Dispatchers.IO) {
        val token = authRepository.accessToken ?: return@withContext null
        restApi().createZone(bearer = "Bearer $token", body = zone).firstOrNull()
    }

    suspend fun updateZone(zoneId: String, zone: ZoneDto): ZoneDto? = withContext(Dispatchers.IO) {
        val token = authRepository.accessToken ?: return@withContext null
        restApi().updateZone(
            bearer = "Bearer $token",
            idFilter = "eq.$zoneId",
            body = zone
        ).firstOrNull()
    }

    suspend fun deactivateZone(zone: ZoneDto): ZoneDto? {
        val zoneId = zone.id ?: return null
        return updateZone(zoneId, zone.copy(isActive = false))
    }

    suspend fun latestZoneStats(zoneId: String): ZoneDailyStatsDto? = withContext(Dispatchers.IO) {
        val token = authRepository.accessToken ?: return@withContext null
        restApi().latestZoneStats(bearer = "Bearer $token", zoneIdFilter = "eq.$zoneId").firstOrNull()
    }

    suspend fun zoneDeals(zoneId: String): List<ListingScoringDto> = withContext(Dispatchers.IO) {
        val token = authRepository.accessToken ?: return@withContext emptyList()
        restApi().zoneDeals(bearer = "Bearer $token", zoneIdFilter = "eq.$zoneId")
    }

    suspend fun listingById(listingId: String): ListingNormalizedDto? = withContext(Dispatchers.IO) {
        val token = authRepository.accessToken ?: return@withContext null
        restApi().listingById(bearer = "Bearer $token", listingIdFilter = "eq.$listingId").firstOrNull()
    }

    suspend fun getProfile(): ProfileDto? = withContext(Dispatchers.IO) {
        val token = authRepository.accessToken ?: return@withContext null
        val uid = authRepository.userId ?: return@withContext null
        restApi().getProfile(bearer = "Bearer $token", userIdFilter = "eq.$uid").firstOrNull()
    }

    suspend fun saveProfile(profile: ProfileDto): ProfileDto? = withContext(Dispatchers.IO) {
        val token = authRepository.accessToken ?: return@withContext null
        restApi().upsertProfile(bearer = "Bearer $token", body = profile).firstOrNull()
    }

    suspend fun registerDeviceToken(tokenValue: String): DeviceTokenDto? = withContext(Dispatchers.IO) {
        val token = authRepository.accessToken ?: return@withContext null
        val uid = authRepository.userId ?: return@withContext null
        val dto = DeviceTokenDto(userId = uid, deviceToken = tokenValue)
        restApi().upsertDeviceToken(bearer = "Bearer $token", body = dto).firstOrNull()
    }
}
