package com.tsc.imowatch.data

import com.tsc.imowatch.BuildConfig
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.PATCH
import retrofit2.http.Query

interface SupabaseAuthApi {
    @POST("auth/v1/token?grant_type=password")
    suspend fun loginWithPassword(
        @Body body: PasswordLoginRequest,
        @Header("apikey") apikey: String = BuildConfig.SUPABASE_ANON_KEY
    ): SessionResponse

    @POST("auth/v1/otp")
    suspend fun sendMagicLink(
        @Body body: MagicLinkRequest,
        @Header("apikey") apikey: String = BuildConfig.SUPABASE_ANON_KEY
    )

    @GET("auth/v1/user")
    suspend fun getCurrentUser(
        @Header("Authorization") bearer: String,
        @Header("apikey") apikey: String = BuildConfig.SUPABASE_ANON_KEY
    ): UserDto
}

interface SupabaseRestApi {
    @GET("rest/v1/zones")
    suspend fun listZones(
        @Header("Authorization") bearer: String,
        @Header("apikey") apikey: String = BuildConfig.SUPABASE_ANON_KEY,
        @Query("select") select: String = "*"
    ): List<ZoneDto>

    @POST("rest/v1/zones")
    suspend fun createZone(
        @Header("Authorization") bearer: String,
        @Header("apikey") apikey: String = BuildConfig.SUPABASE_ANON_KEY,
        @Header("Prefer") prefer: String = "return=representation",
        @Body body: ZoneDto
    ): List<ZoneDto>

    @PATCH("rest/v1/zones")
    suspend fun updateZone(
        @Header("Authorization") bearer: String,
        @Header("apikey") apikey: String = BuildConfig.SUPABASE_ANON_KEY,
        @Header("Prefer") prefer: String = "return=representation",
        @Query("id") idFilter: String,
        @Body body: ZoneDto
    ): List<ZoneDto>

    @GET("rest/v1/zone_daily_stats")
    suspend fun latestZoneStats(
        @Header("Authorization") bearer: String,
        @Header("apikey") apikey: String = BuildConfig.SUPABASE_ANON_KEY,
        @Query("zone_id") zoneIdFilter: String,
        @Query("select") select: String = "*",
        @Query("order") order: String = "stats_date.desc",
        @Query("limit") limit: Int = 1
    ): List<ZoneDailyStatsDto>

    @GET("rest/v1/listing_scoring_daily")
    suspend fun zoneDeals(
        @Header("Authorization") bearer: String,
        @Header("apikey") apikey: String = BuildConfig.SUPABASE_ANON_KEY,
        @Query("zone_id") zoneIdFilter: String,
        @Query("is_deal_p10") isDealFilter: String = "eq.true",
        @Query("select") select: String = "*",
        @Query("order") order: String = "rank_in_zone.asc"
    ): List<ListingScoringDto>

    @GET("rest/v1/profiles")
    suspend fun getProfile(
        @Header("Authorization") bearer: String,
        @Header("apikey") apikey: String = BuildConfig.SUPABASE_ANON_KEY,
        @Query("user_id") userIdFilter: String,
        @Query("select") select: String = "*",
        @Query("limit") limit: Int = 1
    ): List<ProfileDto>

    @POST("rest/v1/profiles")
    suspend fun upsertProfile(
        @Header("Authorization") bearer: String,
        @Header("apikey") apikey: String = BuildConfig.SUPABASE_ANON_KEY,
        @Header("Prefer") prefer: String = "resolution=merge-duplicates,return=representation",
        @Body body: ProfileDto
    ): List<ProfileDto>

    @GET("rest/v1/listings_normalized")
    suspend fun listingById(
        @Header("Authorization") bearer: String,
        @Header("apikey") apikey: String = BuildConfig.SUPABASE_ANON_KEY,
        @Query("id") listingIdFilter: String,
        @Query("select") select: String = "id,title,source,price_eur,contact_phone,contact_email,url",
        @Query("limit") limit: Int = 1
    ): List<ListingNormalizedDto>

    @POST("rest/v1/device_tokens")
    suspend fun upsertDeviceToken(
        @Header("Authorization") bearer: String,
        @Header("apikey") apikey: String = BuildConfig.SUPABASE_ANON_KEY,
        @Header("Prefer") prefer: String = "resolution=merge-duplicates,return=representation",
        @Body body: DeviceTokenDto
    ): List<DeviceTokenDto>
}

object SupabaseApis {
    private fun client(withAuthToken: String? = null): OkHttpClient {
        val logging = HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC }
        val authInterceptor = Interceptor { chain ->
            val requestBuilder = chain.request().newBuilder()
                .addHeader("apikey", BuildConfig.SUPABASE_ANON_KEY)
            if (!withAuthToken.isNullOrBlank()) {
                requestBuilder.addHeader("Authorization", "Bearer $withAuthToken")
            }
            chain.proceed(requestBuilder.build())
        }
        return OkHttpClient.Builder()
            .addInterceptor(authInterceptor)
            .addInterceptor(logging)
            .build()
    }

    fun authApi(): SupabaseAuthApi =
        Retrofit.Builder()
            .baseUrl("${BuildConfig.SUPABASE_URL}/")
            .client(client())
            .addConverterFactory(MoshiConverterFactory.create())
            .build()
            .create(SupabaseAuthApi::class.java)

    fun restApi(authToken: String): SupabaseRestApi =
        Retrofit.Builder()
            .baseUrl("${BuildConfig.SUPABASE_URL}/")
            .client(client(authToken))
            .addConverterFactory(MoshiConverterFactory.create())
            .build()
            .create(SupabaseRestApi::class.java)
}
