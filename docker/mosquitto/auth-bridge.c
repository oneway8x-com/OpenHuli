/* OpenHuli MIT: narrow transport bridge; device policy lives in shared TypeScript use cases. */
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <curl/curl.h>
#include <mosquitto.h>
#include <mosquitto_broker.h>
#include <mosquitto_plugin.h>
#include <mqtt_protocol.h>

static mosquitto_plugin_id_t *plugin_id;
static const char *auth_url;
static const char *auth_token;

static size_t discard_response(char *ptr, size_t size, size_t count, void *userdata)
{
    (void)ptr;
    size_t *received = userdata;
    if (count > 128 || size > 128 || size * count > 128 - *received) return 0;
    *received += size * count;
    return size * count;
}

static int check(const char *path, const char *username, const char *password,
                 const char *client_id, const char *topic, int access, bool retain, const void *payload, int payloadlen)
{
    if (!username || !client_id || strlen(username) > 512 || strlen(client_id) > 128
        || (password && strlen(password) > 1024) || (topic && strlen(topic) > 256)) return 0;
    CURL *curl = curl_easy_init();
    if (!curl) return 0;
    char *u = curl_easy_escape(curl, username, 0);
    char *p = curl_easy_escape(curl, password ? password : "", 0);
    char *c = curl_easy_escape(curl, client_id, 0);
    char *t = curl_easy_escape(curl, topic ? topic : "", 0);
    char *data = curl_easy_escape(curl, payload ? payload : "", payloadlen);
    int allowed = 0;
    struct curl_slist *headers = NULL;
    if (u && p && c && t && data) {
        char url[512], body[65536], header[320];
        int url_size = snprintf(url, sizeof(url), "%s/%s", auth_url, path);
        int body_size = snprintf(body, sizeof(body), "username=%s&password=%s&clientId=%s&topic=%s&access=%d&retain=%s&payload=%s", u, p, c, t, access, retain ? "true" : "false", data);
        int header_size = snprintf(header, sizeof(header), "X-OpenHuli-Broker-Token: %s", auth_token);
        if (url_size > 0 && (size_t)url_size < sizeof(url) && body_size > 0 && (size_t)body_size < sizeof(body)
            && header_size > 0 && (size_t)header_size < sizeof(header)) {
            headers = curl_slist_append(headers, header);
            headers = curl_slist_append(headers, "Content-Type: application/x-www-form-urlencoded");
            size_t received = 0;
            curl_easy_setopt(curl, CURLOPT_URL, url);
            curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
            curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body);
            curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, (long)body_size);
            curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS, 1000L);
            curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT_MS, 300L);
            curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);
            curl_easy_setopt(curl, CURLOPT_PROXY, "");
            curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 0L);
            curl_easy_setopt(curl, CURLOPT_PROTOCOLS_STR, "http,https");
            curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, discard_response);
            curl_easy_setopt(curl, CURLOPT_WRITEDATA, &received);
            CURLcode result = curl_easy_perform(curl);
            long status = 0;
            curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &status);
            allowed = result == CURLE_OK && status == 204;
        }
    }
    curl_slist_free_all(headers);
    curl_free(data); curl_free(u); curl_free(p); curl_free(c); curl_free(t);
    curl_easy_cleanup(curl);
    return allowed;
}

static int basic_auth(int event, void *event_data, void *userdata)
{
    (void)event; (void)userdata;
    struct mosquitto_evt_basic_auth *data = event_data;
    return check("auth", data->username, data->password, mosquitto_client_id(data->client), NULL, 0, false, NULL, 0)
        ? MOSQ_ERR_SUCCESS : MOSQ_ERR_AUTH;
}
static int acl_check(int event, void *event_data, void *userdata)
{
    (void)event; (void)userdata;
    struct mosquitto_evt_acl_check *data = event_data;
    if (data->payloadlen > 16384) return MOSQ_ERR_ACL_DENIED;
    return check("acl", mosquitto_client_username(data->client), NULL, mosquitto_client_id(data->client), data->topic, data->access, data->retain,
        data->access == MOSQ_ACL_WRITE && strstr(data->topic, "/presence") ? data->payload : NULL,
        data->access == MOSQ_ACL_WRITE && strstr(data->topic, "/presence") ? (int)data->payloadlen : 0)
        ? MOSQ_ERR_SUCCESS : MOSQ_ERR_ACL_DENIED;
}
static int attest_message(int event, void *event_data, void *userdata)
{
    (void)event; (void)userdata;
    struct mosquitto_evt_message *data = event_data;
    const char *username = data->client ? mosquitto_client_username(data->client) : NULL;
    if (!username || strncmp(username, "ohm1.", 5) != 0) return MOSQ_ERR_SUCCESS;
    /* Append, never trust a client-supplied reserved property. The consumer requires exactly one. */
    return mosquitto_property_add_string_pair(&data->properties, MQTT_PROP_USER_PROPERTY, "openhuli-identity", username);
}
int mosquitto_plugin_version(int count, const int *versions)
{
    for (int i = 0; i < count; i++) if (versions[i] == 5) return 5;
    return -1;
}
int mosquitto_plugin_init(mosquitto_plugin_id_t *identifier, void **userdata, struct mosquitto_opt *options, int count)
{
    (void)userdata; (void)options; (void)count;
    auth_url = getenv("OPENHULI_MQTT_AUTH_URL");
    auth_token = getenv("OPENHULI_MQTT_AUTH_TOKEN");
    if (!auth_url || strlen(auth_url) > 400 || (strncmp(auth_url, "http://", 7) != 0 && strncmp(auth_url, "https://", 8) != 0)
        || !auth_token || strlen(auth_token) < 32 || strlen(auth_token) > 256) return MOSQ_ERR_INVAL;
    for (const char *c = auth_token; *c; c++) if (!isalnum((unsigned char)*c) && *c != '_' && *c != '-') return MOSQ_ERR_INVAL;
    if (curl_global_init(CURL_GLOBAL_DEFAULT) != CURLE_OK) return MOSQ_ERR_UNKNOWN;
    plugin_id = identifier;
    int result = mosquitto_callback_register(identifier, MOSQ_EVT_BASIC_AUTH, basic_auth, NULL, NULL);
    if (result == MOSQ_ERR_SUCCESS) result = mosquitto_callback_register(identifier, MOSQ_EVT_ACL_CHECK, acl_check, NULL, NULL);
    if (result == MOSQ_ERR_SUCCESS) result = mosquitto_callback_register(identifier, MOSQ_EVT_MESSAGE, attest_message, NULL, NULL);
    return result;
}
int mosquitto_plugin_cleanup(void *userdata, struct mosquitto_opt *options, int count)
{
    (void)userdata; (void)options; (void)count;
    mosquitto_callback_unregister(plugin_id, MOSQ_EVT_BASIC_AUTH, basic_auth, NULL);
    mosquitto_callback_unregister(plugin_id, MOSQ_EVT_ACL_CHECK, acl_check, NULL);
    mosquitto_callback_unregister(plugin_id, MOSQ_EVT_MESSAGE, attest_message, NULL);
    curl_global_cleanup();
    return MOSQ_ERR_SUCCESS;
}
