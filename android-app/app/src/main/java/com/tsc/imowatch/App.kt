package com.tsc.imowatch

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.tsc.imowatch.data.AppRepository
import com.tsc.imowatch.data.AuthRepository
import com.tsc.imowatch.data.ZoneDto
import com.tsc.imowatch.ui.AlertSettingsScreen
import com.tsc.imowatch.ui.AuthScreen
import com.tsc.imowatch.ui.DealDetailScreen
import com.tsc.imowatch.ui.ZoneDashboardScreen
import com.tsc.imowatch.ui.ZoneEditScreen
import com.tsc.imowatch.ui.ZonesHomeScreen
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.launch

private const val ROUTE_AUTH = "auth"
private const val ROUTE_HOME = "home"
private const val ROUTE_ZONE_EDIT_NEW = "zone_edit_new"
private const val ROUTE_ZONE_EDIT_EXISTING = "zone_edit/{zoneId}"
private const val ROUTE_ZONE_DASHBOARD = "zone_dashboard/{zoneId}"
private const val ROUTE_DEAL_DETAIL = "deal_detail/{zoneId}/{listingId}"
private const val ROUTE_ALERT_SETTINGS = "alert_settings"

@Composable
fun DealRadarApp(initialDeepLink: String?) {
    val navController = rememberNavController()
    val authRepository = remember { AuthRepository() }
    val appRepository = remember { AppRepository(authRepository) }
    val scope = rememberCoroutineScope()
    var zones by remember { mutableStateOf<List<ZoneDto>>(emptyList()) }
    var hasConsumedDeepLink by remember { mutableStateOf(false) }

    LaunchedEffect(initialDeepLink) {
        if (!hasConsumedDeepLink && !initialDeepLink.isNullOrBlank()) {
            authRepository.completeMagicLink(initialDeepLink).onSuccess {
                FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
                    scope.launch { appRepository.registerDeviceToken(token) }
                }
                zones = appRepository.listZones()
                navController.navigate(ROUTE_HOME)
            }
            hasConsumedDeepLink = true
        }
    }

    NavHost(navController = navController, startDestination = ROUTE_AUTH) {
        composable(ROUTE_AUTH) {
            AuthScreen(
                onLoginPassword = { email, password ->
                    scope.launch {
                        authRepository.loginWithPassword(email, password).onSuccess {
                            FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
                                scope.launch { appRepository.registerDeviceToken(token) }
                            }
                            zones = appRepository.listZones()
                            navController.navigate(ROUTE_HOME)
                        }
                    }
                },
                onMagicLink = { email ->
                    scope.launch {
                        authRepository.sendMagicLink(email)
                    }
                }
            )
        }
        composable(ROUTE_HOME) {
            ZonesHomeScreen(
                zones = zones,
                onRefresh = {
                    scope.launch { zones = appRepository.listZones() }
                },
                onCreateZone = { navController.navigate(ROUTE_ZONE_EDIT_NEW) },
                onOpenZone = { zoneId -> navController.navigate("zone_dashboard/$zoneId") },
                onEditZone = { zoneId -> navController.navigate("zone_edit/$zoneId") },
                onDeleteZone = { zone ->
                    scope.launch {
                        appRepository.deactivateZone(zone)
                        zones = appRepository.listZones()
                    }
                },
                onOpenAlertSettings = { navController.navigate(ROUTE_ALERT_SETTINGS) }
            )
        }
        composable(ROUTE_ZONE_EDIT_NEW) {
            ZoneEditScreen(
                authUserId = authRepository.userId.orEmpty(),
                existingZone = null,
                onSave = { zone ->
                    scope.launch {
                        appRepository.createZone(zone)
                        zones = appRepository.listZones()
                        navController.popBackStack()
                    }
                },
                onCancel = { navController.popBackStack() }
            )
        }
        composable(
            ROUTE_ZONE_EDIT_EXISTING,
            arguments = listOf(navArgument("zoneId") { type = NavType.StringType })
        ) { entry ->
            val zoneId = entry.arguments?.getString("zoneId").orEmpty()
            val existing = zones.firstOrNull { it.id == zoneId }
            ZoneEditScreen(
                authUserId = authRepository.userId.orEmpty(),
                existingZone = existing,
                onSave = { zone ->
                    scope.launch {
                        if (existing?.id != null) {
                            appRepository.updateZone(existing.id, zone.copy(id = existing.id))
                        } else {
                            appRepository.createZone(zone)
                        }
                        zones = appRepository.listZones()
                        navController.popBackStack()
                    }
                },
                onCancel = { navController.popBackStack() }
            )
        }
        composable(
            ROUTE_ZONE_DASHBOARD,
            arguments = listOf(navArgument("zoneId") { type = NavType.StringType })
        ) { entry ->
            val zoneId = entry.arguments?.getString("zoneId").orEmpty()
            ZoneDashboardScreen(
                zoneId = zoneId,
                onOpenDeal = { listingId ->
                    navController.navigate("deal_detail/$zoneId/$listingId")
                },
                onBack = { navController.popBackStack() },
                repository = appRepository
            )
        }
        composable(
            ROUTE_DEAL_DETAIL,
            arguments = listOf(
                navArgument("zoneId") { type = NavType.StringType },
                navArgument("listingId") { type = NavType.StringType }
            )
        ) { entry ->
            DealDetailScreen(
                zoneId = entry.arguments?.getString("zoneId").orEmpty(),
                listingId = entry.arguments?.getString("listingId").orEmpty(),
                onBack = { navController.popBackStack() },
                repository = appRepository
            )
        }
        composable(ROUTE_ALERT_SETTINGS) {
            AlertSettingsScreen(
                repository = appRepository,
                userId = authRepository.userId.orEmpty(),
                onBack = { navController.popBackStack() }
            )
        }
    }
}
