package com.tsc.imowatch.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.tsc.imowatch.data.AppRepository
import com.tsc.imowatch.data.ListingNormalizedDto
import com.tsc.imowatch.data.ListingScoringDto
import com.tsc.imowatch.data.ProfileDto
import com.tsc.imowatch.data.ZoneDto
import kotlinx.coroutines.launch

@Composable
fun AuthScreen(
    onLoginPassword: (String, String) -> Unit,
    onMagicLink: (String) -> Unit
) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text("DealRadar PT", style = MaterialTheme.typography.headlineMedium)
        Text("Sign in with password or request a magic link.")
        OutlinedTextField(value = email, onValueChange = { email = it }, label = { Text("Email") })
        OutlinedTextField(value = password, onValueChange = { password = it }, label = { Text("Password") })
        Button(onClick = { onLoginPassword(email, password) }, modifier = Modifier.fillMaxWidth()) {
            Text("Login with password")
        }
        Button(onClick = { onMagicLink(email) }, modifier = Modifier.fillMaxWidth()) {
            Text("Send magic link")
        }
    }
}

@Composable
fun ZonesHomeScreen(
    zones: List<ZoneDto>,
    onRefresh: () -> Unit,
    onCreateZone: () -> Unit,
    onOpenZone: (String) -> Unit,
    onEditZone: (String) -> Unit,
    onDeleteZone: (ZoneDto) -> Unit,
    onOpenAlertSettings: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = onRefresh) { Text("Refresh") }
            Button(onClick = onCreateZone) { Text("Create zone") }
            Button(onClick = onOpenAlertSettings) { Text("Alert settings") }
        }
        Text("Your zones", style = MaterialTheme.typography.titleLarge)
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(zones) { zone ->
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { zone.id?.let(onOpenZone) }
                ) {
                    Column(Modifier.padding(12.dp)) {
                        Text(zone.name, style = MaterialTheme.typography.titleMedium)
                        Text("Type: ${zone.zoneType}")
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = { zone.id?.let(onEditZone) }) { Text("Edit") }
                            Button(onClick = { onDeleteZone(zone) }) { Text("Deactivate") }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun ZoneEditScreen(
    authUserId: String,
    existingZone: ZoneDto?,
    onSave: (ZoneDto) -> Unit,
    onCancel: () -> Unit
) {
    var name by remember { mutableStateOf(existingZone?.name ?: "") }
    var zoneType by remember { mutableStateOf(existingZone?.zoneType ?: "radius") }
    var centerLat by remember { mutableStateOf(existingZone?.centerLat?.toString() ?: "38.7223") }
    var centerLng by remember { mutableStateOf(existingZone?.centerLng?.toString() ?: "-9.1393") }
    var radius by remember { mutableStateOf(existingZone?.radiusMeters?.toString() ?: "1500") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text(if (existingZone == null) "Create Zone" else "Edit Zone", style = MaterialTheme.typography.titleLarge)
        OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("Name") })
        OutlinedTextField(value = zoneType, onValueChange = { zoneType = it }, label = { Text("zone_type: radius|admin|polygon") })
        OutlinedTextField(value = centerLat, onValueChange = { centerLat = it }, label = { Text("Center lat") })
        OutlinedTextField(value = centerLng, onValueChange = { centerLng = it }, label = { Text("Center lng") })
        OutlinedTextField(value = radius, onValueChange = { radius = it }, label = { Text("Radius meters") })

        Button(
            onClick = {
                val zone = ZoneDto(
                    id = existingZone?.id,
                    userId = authUserId,
                    name = name,
                    zoneType = zoneType,
                    centerLat = centerLat.toDoubleOrNull(),
                    centerLng = centerLng.toDoubleOrNull(),
                    radiusMeters = radius.toIntOrNull(),
                    // TODO(doc-gap): Replace with map-based polygon/admin builders from APP_FLOW.
                    filters = mapOf("property_type" to "apartment")
                )
                onSave(zone)
            },
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("Save Zone")
        }
        Button(onClick = onCancel, modifier = Modifier.fillMaxWidth()) {
            Text("Cancel")
        }
    }
}

@Composable
fun ZoneDashboardScreen(
    zoneId: String,
    repository: AppRepository,
    onOpenDeal: (String) -> Unit,
    onBack: () -> Unit
) {
    var p10 by remember { mutableStateOf<Double?>(null) }
    var p50 by remember { mutableStateOf<Double?>(null) }
    var p90 by remember { mutableStateOf<Double?>(null) }
    var deals by remember { mutableStateOf<List<ListingScoringDto>>(emptyList()) }

    LaunchedEffect(zoneId) {
        val stats = repository.latestZoneStats(zoneId)
        p10 = stats?.p10RatioYears
        p50 = stats?.p50RatioYears
        p90 = stats?.p90RatioYears
        deals = repository.zoneDeals(zoneId)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Button(onClick = onBack) { Text("Back") }
        Text("Zone Dashboard", style = MaterialTheme.typography.titleLarge)
        Text("P10: ${p10 ?: "-"} | P50: ${p50 ?: "-"} | P90: ${p90 ?: "-"}")
        Text("Deals: ${deals.size}")
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(deals) { deal ->
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onOpenDeal(deal.listingId) }
                ) {
                    Column(Modifier.padding(12.dp)) {
                        Text("Listing ${deal.listingId.take(8)}")
                        Text("Ratio: ${deal.ratioYears}")
                        Text("Est. rent: ${deal.estimatedMonthlyRentEur}")
                    }
                }
            }
        }
    }
}

@Composable
fun DealDetailScreen(
    zoneId: String,
    listingId: String,
    repository: AppRepository,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    var listing by remember { mutableStateOf<ListingNormalizedDto?>(null) }
    var profile by remember { mutableStateOf<ProfileDto?>(null) }

    LaunchedEffect(listingId) {
        listing = repository.listingById(listingId)
        profile = repository.getProfile()
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Button(onClick = onBack) { Text("Back") }
        Text("Deal Detail", style = MaterialTheme.typography.titleLarge)
        Text("Zone: $zoneId")
        Text("Listing: ${listing?.title ?: listingId}")
        Text("Price: ${listing?.priceEur ?: "-"}")
        Text("Source: ${listing?.source ?: "-"}")

        Button(
            enabled = !listing?.url.isNullOrBlank(),
            onClick = {
                listing?.url?.let {
                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(it)))
                }
            },
            modifier = Modifier.fillMaxWidth()
        ) { Text("Open Source Website") }

        Button(
            enabled = !listing?.contactPhone.isNullOrBlank(),
            onClick = {
                val phone = listing?.contactPhone ?: return@Button
                context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$phone")))
            },
            modifier = Modifier.fillMaxWidth()
        ) { Text("Call Now") }

        Button(
            enabled = !listing?.contactEmail.isNullOrBlank(),
            onClick = {
                val to = listing?.contactEmail ?: return@Button
                val subject = profile?.emailTemplateSubject ?: "Offer for property"
                val body = profile?.emailTemplateBody ?: "Hello, I am interested in this listing."
                val uri = Uri.parse("mailto:$to?subject=${Uri.encode(subject)}&body=${Uri.encode(body)}")
                context.startActivity(Intent(Intent.ACTION_SENDTO, uri))
            },
            modifier = Modifier.fillMaxWidth()
        ) { Text("Send Offer Email") }
    }
}

@Composable
fun AlertSettingsScreen(
    repository: AppRepository,
    userId: String,
    onBack: () -> Unit
) {
    val scope = rememberCoroutineScope()
    var channel by remember { mutableStateOf("both") }
    var subject by remember { mutableStateOf("Offer for your listing") }
    var body by remember { mutableStateOf("Hello, I want to make an offer.") }
    var savedText by remember { mutableStateOf("") }

    LaunchedEffect(userId) {
        val existing = repository.getProfile()
        if (existing != null) {
            channel = existing.defaultAlertChannel
            subject = existing.emailTemplateSubject ?: subject
            body = existing.emailTemplateBody ?: body
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Button(onClick = onBack) { Text("Back") }
        Text("Alert Settings", style = MaterialTheme.typography.titleLarge)
        OutlinedTextField(value = channel, onValueChange = { channel = it }, label = { Text("Channel: push|email|both") })
        OutlinedTextField(value = subject, onValueChange = { subject = it }, label = { Text("Email subject") })
        OutlinedTextField(value = body, onValueChange = { body = it }, label = { Text("Email body") })
        Button(
            onClick = {
                if (userId.isNotBlank()) {
                    scope.launch {
                        repository.saveProfile(
                            ProfileDto(
                                userId = userId,
                                defaultAlertChannel = channel,
                                emailTemplateSubject = subject,
                                emailTemplateBody = body
                            )
                        )
                        savedText = "Saved"
                    }
                }
            },
            modifier = Modifier.fillMaxWidth()
        ) { Text("Save") }
        Text(savedText)
    }
}
