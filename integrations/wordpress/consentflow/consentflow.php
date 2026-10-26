<?php
/**
 * Plugin Name:       ConsentFlow Cookie Consent
 * Description:       Adds the ConsentFlow cookie banner, script blocking and Google Consent Mode v2 to your site, plus a [consentflow_declaration] shortcode.
 * Version:           0.1.0
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * License:           GPL-2.0-or-later
 * Text Domain:       consentflow
 */

if (!defined('ABSPATH')) {
    exit;
}

const CONSENTFLOW_OPTION = 'consentflow_settings';

function consentflow_settings(): array
{
    $defaults = ['api_url' => 'http://localhost:4000', 'domain_key' => '', 'enabled' => '1'];
    return wp_parse_args((array) get_option(CONSENTFLOW_OPTION, []), $defaults);
}

/**
 * Print the banner script as the very first thing in <head> (priority -1000) so Google Consent Mode
 * defaults are set and trackers are blocked before any other plugin adds its tags.
 */
add_action('wp_head', function () {
    $s = consentflow_settings();
    if ($s['enabled'] !== '1' || $s['domain_key'] === '' || is_admin()) {
        return;
    }
    $src = rtrim($s['api_url'], '/') . '/v1/cmp/' . rawurlencode($s['domain_key']) . '/cmp.js';
    $lang = substr(get_locale(), 0, 2);
    // Printed directly rather than enqueued: enqueued scripts can be deferred or reordered by optimisation plugins.
    echo '<script src="' . esc_url($src) . '" data-lang="' . esc_attr($lang) . '" data-cfasync="false" data-no-optimize="1"></script>' . "\n";
}, -1000);

/** [consentflow_declaration] renders the cookie declaration table (place it on your cookie policy page). */
add_shortcode('consentflow_declaration', function () {
    return '<div id="consentflow-declaration"></div>';
});

/** [consentflow_settings_link text="Cookie settings"] renders a link that reopens the preference center. */
add_shortcode('consentflow_settings_link', function ($atts) {
    $atts = shortcode_atts(['text' => __('Cookie settings', 'consentflow')], $atts);
    return '<a href="#" onclick="window.ConsentFlow&&ConsentFlow.showPreferences();return false;">' . esc_html($atts['text']) . '</a>';
});

// ---- Settings page ---------------------------------------------------------

add_action('admin_menu', function () {
    add_options_page('ConsentFlow', 'ConsentFlow', 'manage_options', 'consentflow', 'consentflow_render_settings');
});

add_action('admin_init', function () {
    register_setting('consentflow', CONSENTFLOW_OPTION, [
        'type' => 'array',
        'sanitize_callback' => function ($input) {
            return [
                'api_url' => esc_url_raw(trim($input['api_url'] ?? '')),
                'domain_key' => preg_replace('/[^A-Za-z0-9_-]/', '', $input['domain_key'] ?? ''),
                'enabled' => !empty($input['enabled']) ? '1' : '0',
            ];
        },
    ]);
});

function consentflow_render_settings()
{
    if (!current_user_can('manage_options')) {
        return;
    }
    $s = consentflow_settings();
    ?>
    <div class="wrap">
        <h1>ConsentFlow</h1>
        <p>Find the domain key in your ConsentFlow dashboard under <strong>Settings &amp; install</strong>.</p>
        <form method="post" action="options.php">
            <?php settings_fields('consentflow'); ?>
            <table class="form-table" role="presentation">
                <tr>
                    <th scope="row"><label for="cf-api">API URL</label></th>
                    <td><input id="cf-api" class="regular-text" type="url" name="<?php echo esc_attr(CONSENTFLOW_OPTION); ?>[api_url]" value="<?php echo esc_attr($s['api_url']); ?>"></td>
                </tr>
                <tr>
                    <th scope="row"><label for="cf-key">Domain key</label></th>
                    <td><input id="cf-key" class="regular-text code" name="<?php echo esc_attr(CONSENTFLOW_OPTION); ?>[domain_key]" value="<?php echo esc_attr($s['domain_key']); ?>"></td>
                </tr>
                <tr>
                    <th scope="row">Banner</th>
                    <td><label><input type="checkbox" name="<?php echo esc_attr(CONSENTFLOW_OPTION); ?>[enabled]" value="1" <?php checked($s['enabled'], '1'); ?>> Show the banner on this site</label></td>
                </tr>
            </table>
            <?php submit_button(); ?>
        </form>
        <h2>Shortcodes</h2>
        <p><code>[consentflow_declaration]</code> shows the cookie declaration. <code>[consentflow_settings_link]</code> adds a "Cookie settings" link.</p>
    </div>
    <?php
}
