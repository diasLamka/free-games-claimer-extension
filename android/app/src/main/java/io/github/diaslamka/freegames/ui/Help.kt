package io.github.diaslamka.freegames.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import io.github.diaslamka.freegames.R
import io.github.diaslamka.freegames.data.Relay
import io.github.diaslamka.freegames.data.Rules
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.HelpRequest
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.ui.theme.LocalBrut

/*
 * « Le PC a besoin de toi » (1.4.0). Une verification humaine arrete le PC sur
 * un jeu ; le telephone le prend avec SA session, et c'est l'humain qui fait
 * la verification, a l'ecran. L'appli ne resout jamais rien seule.
 */

/**
 * Les demandes d'aide du PC, en tete de l'ecran des jeux : un bloc noir, un
 * tampon, et pour chaque jeu « Finir ici » -- s'il est dans les offres de
 * l'appli -- ou la croix qui l'ecarte.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun HelpBanner(
    requests: List<Pair<String, HelpRequest>>,
    state: AppState,
    claiming: Boolean,
    onFinish: (Offer) -> Unit,
    onDismiss: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val b = LocalBrut.current
    Column(
        modifier.fillMaxWidth().padding(end = 5.dp, bottom = 5.dp)
            .brut(Color.Black, shadow = b.accent, line = if (b.dark) Color.White else Color.Black)
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Stamp(stringResource(R.string.help_banner_title), Modifier.semantics { heading() })
        Text(stringResource(R.string.help_banner_text), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.inverseOnSurface)
        requests.forEach { (key, h) ->
            val offer = Relay.findOffer(state, h.store, h.id, h.title)
            FlowRow(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                itemVerticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.widthIn(min = 140.dp).weight(1f)) {
                    Text(h.title, style = MaterialTheme.typography.titleSmall, color = b.accent, maxLines = 2)
                    Text(Stores.label(h.store), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.inverseOnSurface)
                }
                if (offer != null && Rules.claimedEntry(offer, state.library) == null) {
                    BrutButton(stringResource(R.string.help_finish), { onFinish(offer) }, enabled = !claiming)
                }
                SquareButton(Icons.Rounded.Close, stringResource(R.string.help_dismiss), { onDismiss(key) })
            }
        }
    }
}

/** Ce que l'appli fait d'un lien `fgclaimer://finir` : ce qu'il designe, et la question. */
sealed interface HelpAsk {
    data class Found(val link: Relay.AppLink, val offer: Offer) : HelpAsk
    data class Owned(val link: Relay.AppLink) : HelpAsk
    data class Missing(val link: Relay.AppLink) : HelpAsk
    data class Looking(val link: Relay.AppLink) : HelpAsk
}

/** Le lien, confronte aux offres de l'appli. `refreshed` : les offres viennent d'etre relues. */
fun resolveHelp(link: Relay.AppLink, state: AppState, refreshed: Boolean): HelpAsk {
    val offer = Relay.findOffer(state, link.store, link.id, link.title)
    return when {
        offer != null && Rules.claimedEntry(offer, state.library) != null -> HelpAsk.Owned(link)
        offer != null -> HelpAsk.Found(link, offer)
        refreshed -> HelpAsk.Missing(link)
        else -> HelpAsk.Looking(link)
    }
}

/**
 * La question, quand un lien ouvre l'appli (l'alerte ntfy du PC, ou la
 * notification du relais). Rien ne part sans un appui sur « Finir ici » : un
 * lien peut venir de n'importe ou.
 */
@Composable
fun HelpDialog(ask: HelpAsk, onFinish: (Offer) -> Unit, onDismiss: () -> Unit) {
    val (title, text) = when (ask) {
        is HelpAsk.Found -> stringResource(R.string.help_dialog_title) to
            stringResource(R.string.help_dialog_text, ask.offer.shownTitle, Stores.label(ask.offer.store))
        is HelpAsk.Owned -> stringResource(R.string.help_banner_title) to stringResource(R.string.help_already, ask.link.title)
        is HelpAsk.Missing -> stringResource(R.string.help_banner_title) to stringResource(R.string.help_not_found, ask.link.title)
        is HelpAsk.Looking -> stringResource(R.string.help_banner_title) to stringResource(R.string.help_looking, ask.link.title)
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(text) },
        confirmButton = {
            if (ask is HelpAsk.Found) TextButton(onClick = { onFinish(ask.offer) }) { Text(stringResource(R.string.help_finish)) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(if (ask is HelpAsk.Found) R.string.help_later else R.string.close)) }
        },
    )
}
